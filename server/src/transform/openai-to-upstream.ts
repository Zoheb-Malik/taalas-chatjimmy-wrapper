import type {
	OpenAIChatCompletionRequest,
	OpenAIChatMessage,
	UpstreamChatRequest,
} from "../types.js";

const DEFAULT_MODEL = "llama3.1-8B";
const DEFAULT_TOP_K = 8;
const DEFAULT_MAX_INPUT_TOKENS = 6064;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const ESTIMATED_MESSAGE_OVERHEAD_TOKENS = 8;
const TOKEN_BUDGET_SAFETY_RATIO = 0.82;

export interface UpstreamBuildMeta {
	originalEstimatedTokens: number;
	finalEstimatedTokens: number;
	droppedMessageCount: number;
	truncatedChars: number;
}

export interface UpstreamBuildResult {
	body: UpstreamChatRequest;
	meta: UpstreamBuildMeta;
}

/**
 * Lightweight token estimate based on character count.
 * This is intentionally approximate so we can trim oversized prompts cheaply.
 */
function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

/**
 * Normalizes one rich-content item into plain text.
 * Handles mixed formats used by different OpenAI-compatible clients.
 */
function normalizeContentPart(part: unknown): string {
	if (!part || typeof part !== "object") return "";
	const rec = part as Record<string, unknown>;
	const text =
		typeof rec.text === "string"
			? rec.text
			: typeof rec.input_text === "string"
				? rec.input_text
				: "";
	if (text) return text;
	if (typeof rec.content === "string") return rec.content;
	return "";
}

/**
 * Converts OpenAI message content into a plain text string for upstream.
 */
function normalizeContent(content: OpenAIChatMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => normalizeContentPart(part))
			.filter((part) => part.length > 0)
			.join("\n");
	}
	return "";
}

/**
 * Estimates prompt cost for one message, including metadata fields.
 */
function estimateMessageTokens(message: OpenAIChatMessage): number {
	const roleTokens = estimateTokens(message.role);
	const nameTokens = estimateTokens(message.name ?? "");
	const toolCallIdTokens = estimateTokens(message.tool_call_id ?? "");
	const contentTokens = estimateTokens(normalizeContent(message.content));
	const toolCallsTokens = estimateTokens(
		message.tool_calls ? JSON.stringify(message.tool_calls) : "",
	);
	return (
		ESTIMATED_MESSAGE_OVERHEAD_TOKENS +
		roleTokens +
		nameTokens +
		toolCallIdTokens +
		contentTokens +
		toolCallsTokens
	);
}

/**
 * Estimates total prompt token cost for system prompt + message list.
 */
function estimatePromptTokens(
	systemPrompt: string,
	messages: OpenAIChatMessage[],
): number {
	return (
		estimateTokens(systemPrompt) +
		messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
	);
}

/**
 * Fits messages into the configured upstream token budget.
 * Strategy:
 * - keep newest messages first
 * - if still too large, truncate last kept message content
 */
function trimMessagesToTokenLimit(
	systemPrompt: string,
	messages: OpenAIChatMessage[],
	maxInputTokens: number,
): {
	messages: OpenAIChatMessage[];
	originalEstimatedTokens: number;
	finalEstimatedTokens: number;
	droppedMessageCount: number;
	truncatedChars: number;
} {
	const originalEstimatedTokens = estimatePromptTokens(systemPrompt, messages);
	if (originalEstimatedTokens <= maxInputTokens) {
		return {
			messages,
			originalEstimatedTokens,
			finalEstimatedTokens: originalEstimatedTokens,
			droppedMessageCount: 0,
			truncatedChars: 0,
		};
	}

	const kept: OpenAIChatMessage[] = [];
	for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
		const candidate = [messages[idx] as OpenAIChatMessage, ...kept];
		const estimated = estimatePromptTokens(systemPrompt, candidate);
		if (estimated <= maxInputTokens || kept.length === 0) {
			kept.unshift(messages[idx] as OpenAIChatMessage);
		}
	}

	let truncatedChars = 0;
	let finalMessages = kept;
	let finalEstimatedTokens = estimatePromptTokens(systemPrompt, finalMessages);

	if (finalEstimatedTokens > maxInputTokens && finalMessages.length > 0) {
		const lastIdx = finalMessages.length - 1;
		const last = finalMessages[lastIdx] as OpenAIChatMessage;
		const content = normalizeContent(last.content);
		const budgetForContentTokens = Math.max(
			1,
			maxInputTokens -
				estimateTokens(systemPrompt) -
				(estimateMessageTokens(last) - estimateTokens(content)),
		);
		const maxChars = budgetForContentTokens * ESTIMATED_CHARS_PER_TOKEN;
		if (content.length > maxChars) {
			const shortened = content.slice(0, maxChars);
			truncatedChars = content.length - shortened.length;
			finalMessages = [...finalMessages];
			finalMessages[lastIdx] = {
				...last,
				content: shortened,
			};
			finalEstimatedTokens = estimatePromptTokens(systemPrompt, finalMessages);
		}
	}

	return {
		messages: finalMessages,
		originalEstimatedTokens,
		finalEstimatedTokens,
		droppedMessageCount: Math.max(0, messages.length - finalMessages.length),
		truncatedChars,
	};
}

/**
 * Converts one OpenAI Chat Completions request into chatjimmy upstream format.
 * Also returns trimming metadata so logs can explain what was dropped/truncated.
 */
export function buildUpstreamChatRequest(
	input: OpenAIChatCompletionRequest,
	options: { maxInputTokens?: number } = {},
): UpstreamBuildResult {
	const rawMaxInputTokens = options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
	const maxInputTokens = Math.max(
		1,
		Math.floor(rawMaxInputTokens * TOKEN_BUDGET_SAFETY_RATIO),
	);
	const systemPrompt = input.messages
		.filter((message) => message.role === "system" && message.content)
		.map((message) => normalizeContent(message.content))
		.filter((segment) => segment.length > 0)
		.join("\n\n");

	const nonSystemMessages = input.messages.filter(
		(message) => message.role !== "system",
	);
	const trimmed = trimMessagesToTokenLimit(
		systemPrompt,
		nonSystemMessages,
		maxInputTokens,
	);

	const messages = trimmed.messages.map((message) => {
		const mapped: Record<string, unknown> = {
			role: message.role,
			content: normalizeContent(message.content),
		};
		if (message.name) mapped.name = message.name;
		if (message.tool_call_id) mapped.tool_call_id = message.tool_call_id;
		if (message.tool_calls) mapped.tool_calls = message.tool_calls;
		return mapped;
	});
	const disableTools = input.tool_choice === "none";

	return {
		body: {
			messages,
			chatOptions: {
				selectedModel: input.model ?? DEFAULT_MODEL,
				systemPrompt,
				topK: DEFAULT_TOP_K,
			},
			tools: disableTools ? undefined : input.tools,
			tool_choice: disableTools ? undefined : input.tool_choice,
		},
		meta: {
			originalEstimatedTokens: trimmed.originalEstimatedTokens,
			finalEstimatedTokens: trimmed.finalEstimatedTokens,
			droppedMessageCount: trimmed.droppedMessageCount,
			truncatedChars: trimmed.truncatedChars,
		},
	};
}
