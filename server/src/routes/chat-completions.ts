import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import type { ChatJimmyClient } from "../upstream/chatjimmy-client.js";
import type { OpenAIChatCompletionRequest, OpenAIToolCall } from "../types.js";
import { buildUpstreamChatRequest } from "../transform/openai-to-upstream.js";
import {
  buildChatCompletionResponse,
  buildOpenAIError,
  computeUsage,
  makeCompletionId,
  normalizeFinishReason,
} from "../transform/upstream-to-openai.js";
import {
  parseUpstreamChunk,
  type ParsedUpstreamEvent,
  UpstreamChunkParser,
} from "../stream/upstream-data-parser.js";
import { buildUpstreamForwardHeaders } from "../upstream/forward-headers.js";

const STATS_REGEX = /<\|stats\|>([\s\S]*?)<\|\/stats\|>/g;
const MAX_LOG_TEXT_PREVIEW = 2000;

/**
 * Extracts trailing `<|stats|>...</|stats|>` metadata from upstream text.
 * Returns cleaned assistant text plus usage/finish details when present.
 */
function parseStatsFromText(raw: string): {
  cleanedText: string;
  prompt: number;
  completion: number;
  finishReason: string;
  hasStats: boolean;
} {
  let prompt = 0;
  let completion = 0;
  let finishReason = "stop";
  let hasStats = false;
  let cleanedText = raw;
  const match = raw.match(STATS_REGEX);
  if (match && match.length > 0) {
    hasStats = true;
    const lastBlock = match[match.length - 1];
    const json = lastBlock.replace("<|stats|>", "").replace("<|/stats|>", "");
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (typeof parsed.prefill_tokens === "number")
        prompt = parsed.prefill_tokens;
      else if (typeof parsed.promptTokens === "number")
        prompt = parsed.promptTokens;
      else if (typeof parsed.prompt_tokens === "number")
        prompt = parsed.prompt_tokens;

      if (typeof parsed.decode_tokens === "number")
        completion = parsed.decode_tokens;
      else if (typeof parsed.completionTokens === "number")
        completion = parsed.completionTokens;
      else if (typeof parsed.completion_tokens === "number")
        completion = parsed.completion_tokens;

      const rawFinishReason =
        typeof parsed.done_reason === "string"
          ? parsed.done_reason
          : typeof parsed.finishReason === "string"
            ? parsed.finishReason
            : typeof parsed.doneReason === "string"
              ? parsed.doneReason
              : "stop";
      finishReason = rawFinishReason;
    } catch {
      // Ignore malformed stats suffix and continue with defaults.
    }
    cleanedText = raw.replace(STATS_REGEX, "");
  }
  return { cleanedText, prompt, completion, finishReason, hasStats };
}

/**
 * Shared state used to aggregate upstream events into OpenAI-compatible output.
 */
interface UpstreamAggregationState {
  content: string;
  toolCalls: OpenAIToolCall[];
  toolCallIds: Set<string>;
  finishReason: string;
  prompt: number;
  completion: number;
}

interface UpstreamEventEffect {
  textDelta?: string;
  toolCall?: OpenAIToolCall;
  done?: boolean;
}

function createUpstreamAggregationState(): UpstreamAggregationState {
  return {
    content: "",
    toolCalls: [],
    toolCallIds: new Set<string>(),
    finishReason: "stop",
    prompt: 0,
    completion: 0,
  };
}

/**
 * Applies one parsed upstream event to shared aggregation state.
 * This keeps stream and non-stream logic in sync.
 */
function applyUpstreamEvent(
  state: UpstreamAggregationState,
  event: ParsedUpstreamEvent,
): UpstreamEventEffect {
  if (event.type === "text") {
    const stats = parseStatsFromText(event.delta);
    state.content += stats.cleanedText;
    if (stats.hasStats) {
      state.prompt = stats.prompt;
      state.completion = stats.completion;
      state.finishReason = stats.finishReason;
    }
    return stats.cleanedText ? { textDelta: stats.cleanedText } : {};
  }
  if (event.type === "tool_call") {
    if (state.toolCallIds.has(event.call.id)) return {};
    state.toolCallIds.add(event.call.id);
    state.toolCalls.push(event.call);
    return { toolCall: event.call };
  }
  state.finishReason = event.finishReason;
  if (event.usage) {
    state.prompt = event.usage.prompt;
    state.completion = event.usage.completion;
  }
  return { done: true };
}

function finalizeUpstreamAggregation(state: UpstreamAggregationState): {
  content: string;
  toolCalls: OpenAIToolCall[];
  finalReason: "stop" | "tool_calls" | "length" | "content_filter";
  prompt: number;
  completion: number;
  hasSignal: boolean;
} {
  const hasSignal =
    state.content.trim().length > 0 ||
    state.toolCalls.length > 0 ||
    state.prompt > 0 ||
    state.completion > 0;

  return {
    content: state.content,
    toolCalls: state.toolCalls,
    finalReason:
      state.toolCalls.length > 0
        ? "tool_calls"
        : normalizeFinishReason(state.finishReason),
    prompt: state.prompt,
    completion: state.completion,
    hasSignal,
  };
}

/**
 * Normalizes non-stream upstream output into one OpenAI completion payload state.
 */
function aggregateNonStreamUpstreamOutput(raw: string): {
  content: string;
  toolCalls: OpenAIToolCall[];
  finalReason: "stop" | "tool_calls" | "length" | "content_filter";
  prompt: number;
  completion: number;
  hasSignal: boolean;
} {
  const state = createUpstreamAggregationState();
  for (const event of parseUpstreamChunk(raw)) {
    applyUpstreamEvent(state, event);
  }
  return finalizeUpstreamAggregation(state);
}

/**
 * Writes one OpenAI SSE `data: ...` event frame to the response stream.
 */
function emitSseChunk(
  reply: FastifyReply,
  payload: Record<string, unknown>,
): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Sends final SSE terminator and closes the response stream.
 */
function emitDone(reply: FastifyReply): void {
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}

/**
 * Removes `tools` and `tool_choice` fields before upstream forwarding.
 * Used when experimental tool mode is turned off.
 */
function stripTooling(
  input: OpenAIChatCompletionRequest,
): OpenAIChatCompletionRequest {
  const { tools: _tools, tool_choice: _toolChoice, ...rest } = input;
  return rest;
}

/**
 * Registers `/v1/chat/completions` with OpenAI-compatible request/response behavior.
 * This is the core wrapper endpoint (validation, transform, relay, and format mapping).
 */
export function registerChatCompletionsRoute(
  app: FastifyInstance,
  client: ChatJimmyClient,
  config: AppConfig,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const body = request.body as OpenAIChatCompletionRequest;
    if (!body || !Array.isArray(body.messages)) {
      const out = buildOpenAIError(
        400,
        "Invalid request body: messages array is required.",
      );
      return reply.code(out.status).send(out.body);
    }

    const requestedToolChoice = body.tool_choice;
    const requestedToolCount = body.tools?.length ?? 0;
    const toolUsageRequested =
      requestedToolCount > 0 || typeof requestedToolChoice !== "undefined";
    if (!config.experimentalToolUsage && requestedToolChoice === "required") {
      request.log.warn(
        {
          event: "tool_usage_rejected",
          reason: "required_requested_while_disabled",
          experimentalToolUsage: config.experimentalToolUsage,
        },
        "rejecting required tool request while experimental tool mode is disabled",
      );
      const out = buildOpenAIError(
        400,
        "Tool usage is disabled (EXPERIMENTAL_TOOL_USAGE=false). Set EXPERIMENTAL_TOOL_USAGE=true to allow best-effort tool handling.",
      );
      return reply.code(out.status).send(out.body);
    }

    const requestBody =
      config.experimentalToolUsage || !toolUsageRequested
        ? body
        : stripTooling(body);
    const stream =
      typeof body.stream === "boolean" ? body.stream : config.defaultStream;
    if (!config.experimentalToolUsage && toolUsageRequested) {
      request.log.info(
        {
          event: "tool_usage_stripped",
          experimentalToolUsage: config.experimentalToolUsage,
          requestedToolChoice: requestedToolChoice ?? "unset",
          requestedToolCount,
        },
        "tool fields stripped because experimental tool mode is disabled",
      );
    }

    const model = requestBody.model ?? "llama3.1-8B";
    const userMessages = requestBody.messages.filter(
      (message) => message.role === "user",
    );
    const latestUserMessage = userMessages.length
      ? userMessages[userMessages.length - 1]?.content
      : null;
    const latestUserMessagePreview =
      typeof latestUserMessage === "string"
        ? latestUserMessage.slice(0, MAX_LOG_TEXT_PREVIEW)
        : latestUserMessage;
    request.log.info(
      {
        event: "chat_completion_received",
        model,
        stream,
        messageCount: requestBody.messages.length,
        hasTools: Boolean(requestBody.tools?.length),
        toolCount: requestBody.tools?.length ?? 0,
        toolChoice: requestBody.tool_choice ?? "unset",
        requestedToolChoice: requestedToolChoice ?? "unset",
        requestedToolCount,
        experimentalToolUsage: config.experimentalToolUsage,
        latestUserMessagePreview,
      },
      "processing chat completion request",
    );
    const upstreamRequest = buildUpstreamChatRequest(requestBody, {
      maxInputTokens: config.prefillTokenLimit,
    });
    const upstreamBody = upstreamRequest.body;
    if (
      upstreamRequest.meta.droppedMessageCount > 0 ||
      upstreamRequest.meta.truncatedChars > 0
    ) {
      request.log.warn(
        {
          event: "upstream_request_trimmed",
          prefillTokenLimit: config.prefillTokenLimit,
          originalEstimatedTokens: upstreamRequest.meta.originalEstimatedTokens,
          finalEstimatedTokens: upstreamRequest.meta.finalEstimatedTokens,
          droppedMessageCount: upstreamRequest.meta.droppedMessageCount,
          truncatedChars: upstreamRequest.meta.truncatedChars,
        },
        "trimmed request to fit upstream input budget",
      );
    }

    const upstreamBodyBytes = Buffer.byteLength(
      JSON.stringify(upstreamBody),
      "utf8",
    );
    if (upstreamBodyBytes > config.upstreamRequestByteLimit) {
      request.log.warn(
        {
          event: "upstream_payload_too_large",
          upstreamBodyBytes,
          upstreamRequestByteLimit: config.upstreamRequestByteLimit,
        },
        "rejecting oversized upstream payload",
      );
      const out = buildOpenAIError(
        413,
        `Request is too large for upstream (${upstreamBodyBytes} bytes). Reduce message/tool payload size.`,
      );
      return reply.code(out.status).send(out.body);
    }
    let upstream;
    try {
      upstream = await client.postChat(
        upstreamBody,
        buildUpstreamForwardHeaders(
          {
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
          },
          config,
        ),
      );
      request.log.info(
        {
          event: "upstream_chat_response_headers",
          status: upstream.status,
          statusText: upstream.statusText,
          contentType: upstream.headers.get("content-type"),
        },
        "received upstream chat response",
      );
    } catch (error) {
      app.log.error(
        {
          event: "upstream_chat_request_failed",
          error,
          model,
          stream,
        },
        "upstream chat request failed",
      );
      const out = buildOpenAIError(502, "Upstream chat request failed.");
      return reply.code(out.status).send(out.body);
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "Upstream error");
      request.log.error(
        {
          event: "upstream_chat_non_ok",
          status: upstream.status,
          statusText: upstream.statusText,
          errorText: text,
        },
        "upstream returned non-ok status",
      );
      const out = buildOpenAIError(
        upstream.status,
        text || upstream.statusText,
      );
      return reply.code(out.status).send(out.body);
    }

    if (!stream) {
      const text = await upstream.text();
      const aggregated = aggregateNonStreamUpstreamOutput(text);
      if (!aggregated.hasSignal) {
        request.log.warn(
          {
            event: "upstream_empty_success_response",
            model,
            estimatedInputTokens: upstreamRequest.meta.finalEstimatedTokens,
            prefillTokenLimit: config.prefillTokenLimit,
          },
          "upstream returned empty successful response",
        );
        const out = buildOpenAIError(
          422,
          "Upstream returned an empty response. Reduce input context size or lower UPSTREAM_PREFILL_TOKEN_LIMIT.",
        );
        return reply.code(out.status).send(out.body);
      }
      request.log.info(
        {
          event: "non_stream_upstream_text",
          rawLength: text.length,
          cleanedLength: aggregated.content.length,
          toolCallCount: aggregated.toolCalls.length,
          usage: {
            prompt: aggregated.prompt,
            completion: aggregated.completion,
          },
        },
        "processed non-stream upstream response",
      );
      const response = buildChatCompletionResponse({
        model,
        output: {
          content: aggregated.content,
          toolCalls: aggregated.toolCalls,
          finishReason: aggregated.finalReason,
          usage: computeUsage(aggregated.prompt, aggregated.completion),
        },
      });
      request.log.info(
        {
          event: "non_stream_openai_response",
          model,
          choiceCount: 1,
          finishReason: aggregated.finalReason,
          responsePreview: {
            id: response["id"],
            model: response["model"],
          },
        },
        "sending non-stream OpenAI response",
      );
      return reply.send(response);
    }

    if (!upstream.body) {
      const out = buildOpenAIError(502, "Upstream stream response is empty.");
      return reply.code(out.status).send(out.body);
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const completionId = makeCompletionId();
    const created = Math.floor(Date.now() / 1000);
    emitSseChunk(reply, {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const parser = new UpstreamChunkParser();
    const aggregateState = createUpstreamAggregationState();
    const toolCallIndexes = new Map<string, number>();
    let chunkCount = 0;
    let textEventCount = 0;
    let toolEventCount = 0;
    const includeUsageInStream = Boolean(
      requestBody.stream_options?.include_usage,
    );
    const processEvent = (event: ParsedUpstreamEvent): void => {
      const effect = applyUpstreamEvent(aggregateState, event);
      if (effect.textDelta) {
        textEventCount += 1;
        emitSseChunk(reply, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: effect.textDelta },
              finish_reason: null,
            },
          ],
        });
        return;
      }
      if (effect.toolCall) {
        toolEventCount += 1;
        const toolIndex = toolCallIndexes.size;
        toolCallIndexes.set(effect.toolCall.id, toolIndex);
        request.log.info(
          {
            event: "tool_call_detected",
            toolCallId: effect.toolCall.id,
            toolName: effect.toolCall.function.name,
            toolArguments: effect.toolCall.function.arguments,
          },
          "tool call surfaced from upstream stream",
        );
        emitSseChunk(reply, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: toolCallIndexes.get(effect.toolCall.id) ?? 0,
                    id: effect.toolCall.id,
                    type: "function",
                    function: effect.toolCall.function,
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        return;
      }
      if (!effect.done) return;
      request.log.info(
        {
          event: "stream_done_event",
          finishReason: aggregateState.finishReason,
          usage: {
            prompt: aggregateState.prompt,
            completion: aggregateState.completion,
          },
        },
        "received stream completion event",
      );
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount += 1;
        const chunk = decoder.decode(value, { stream: true });
        const events = parser.parseChunk(chunk);
        request.log.debug(
          {
            event: "stream_chunk_received",
            chunkCount,
            chunkLength: chunk.length,
            parsedEventCount: events.length,
            chunkPreview: chunk.slice(0, 500),
          },
          "received upstream stream chunk",
        );
        for (const event of events) processEvent(event);
      }

      const finalEvents = parser.flush();
      for (const event of finalEvents) processEvent(event);
    } catch (error) {
      app.log.error(
        {
          event: "stream_relay_failed",
          error,
          chunkCount,
          textEventCount,
          toolEventCount,
          collectedToolCalls: [...aggregateState.toolCallIds],
        },
        "stream relay failed",
      );
      const out = buildOpenAIError(502, "Upstream stream failed.");
      emitSseChunk(reply, out.body);
      emitDone(reply);
      return;
    }

    const final = finalizeUpstreamAggregation(aggregateState);
    request.log.info(
      {
        event: "stream_completed",
        model,
        chunkCount,
        textEventCount,
        toolEventCount,
        toolCallIds: [...aggregateState.toolCallIds],
        finalReason: final.finalReason,
        usage: computeUsage(final.prompt, final.completion),
      },
      "sending final stream completion chunk",
    );
    emitSseChunk(reply, {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: final.finalReason }],
      ...(includeUsageInStream
        ? { usage: computeUsage(final.prompt, final.completion) }
        : {}),
    });
    emitDone(reply);
  });
}
