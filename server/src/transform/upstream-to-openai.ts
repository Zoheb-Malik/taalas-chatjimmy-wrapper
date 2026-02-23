import type { OpenAIToolCall, OpenAIUsage } from "../types.js";

export interface AggregatedAssistantOutput {
	content: string;
	toolCalls: OpenAIToolCall[];
	finishReason: string;
	usage: OpenAIUsage;
}

export interface FinalizeInput {
	model: string;
	output: AggregatedAssistantOutput;
}

/**
 * Generates an OpenAI-style completion id (`chatcmpl_*`).
 */
export function makeCompletionId(): string {
	return `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Maps upstream finish reasons into OpenAI-compatible values.
 */
export function normalizeFinishReason(
	raw: string,
): "stop" | "tool_calls" | "length" | "content_filter" {
	if (raw === "tool_calls" || raw === "function_call") return "tool_calls";
	if (raw === "length") return "length";
	if (raw === "content_filter") return "content_filter";
	return "stop";
}

/**
 * Builds OpenAI token usage object from prompt/completion counts.
 */
export function computeUsage(prompt: number, completion: number): OpenAIUsage {
	const promptTokens = Number.isFinite(prompt) ? prompt : 0;
	const completionTokens = Number.isFinite(completion) ? completion : 0;
	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
	};
}

/**
 * Creates a full non-stream `chat.completion` response payload.
 */
export function buildChatCompletionResponse(
	input: FinalizeInput,
): Record<string, unknown> {
	const completionId = makeCompletionId();
	const created = Math.floor(Date.now() / 1000);
	const finishReason = normalizeFinishReason(input.output.finishReason);
	const hasToolCalls = input.output.toolCalls.length > 0;

	return {
		id: completionId,
		object: "chat.completion",
		created,
		model: input.model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: hasToolCalls ? null : input.output.content,
					...(hasToolCalls ? { tool_calls: input.output.toolCalls } : {}),
				},
				finish_reason: hasToolCalls ? "tool_calls" : finishReason,
			},
		],
		usage: input.output.usage,
	};
}

/**
 * Produces OpenAI-style error shape while preserving HTTP status code.
 */
export function buildOpenAIError(
	status: number,
	message: string,
): { status: number; body: Record<string, unknown> } {
	const type =
		status === 401
			? "authentication_error"
			: status === 403
				? "permission_error"
				: status === 404
					? "not_found_error"
					: status === 429
						? "rate_limit_error"
						: status >= 500
							? "server_error"
							: "invalid_request_error";
	return {
		status,
		body: {
			error: {
				message,
				type,
				code: status,
			},
		},
	};
}
