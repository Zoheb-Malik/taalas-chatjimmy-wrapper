import type { OpenAIToolCall } from "../types.js";

export type ParsedUpstreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: OpenAIToolCall }
  | {
      type: "done";
      finishReason: string;
      usage?: { prompt: number; completion: number };
    };

const CODE_MAP = {
  "0": "text",
  "1": "function_call",
  "7": "tool_calls",
  "9": "tool_call",
  d: "finish_message",
} as const;

/**
 * Parses one logical upstream line into typed events.
 * Supports chatjimmy's custom line protocol and regular SSE lines.
 */
function parseLine(line: string): ParsedUpstreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const dataProtocol = parseDataProtocolLine(trimmed);
  if (dataProtocol.length > 0) return dataProtocol;
  const sse = parseSseLine(trimmed);
  if (sse.length > 0) return sse;
  // Preserve fallback text only when protocol parsing fails.
  return [{ type: "text", delta: line }];
}

/**
 * JSON parse helper that never throws.
 */
function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Normalizes different tool-call shapes into one OpenAI-compatible structure.
 */
function normalizeToolCall(input: unknown): OpenAIToolCall | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const directName =
    typeof rec.toolName === "string" ? rec.toolName : undefined;
  const directArgs = rec.args;
  const fn =
    rec.function && typeof rec.function === "object"
      ? (rec.function as Record<string, unknown>)
      : undefined;
  const name =
    directName ?? (typeof fn?.name === "string" ? fn.name : undefined);
  const id =
    typeof rec.toolCallId === "string"
      ? rec.toolCallId
      : typeof rec.id === "string"
        ? rec.id
        : undefined;
  if (!name || !id) return null;

  let argsString = "{}";
  if (typeof directArgs === "string") argsString = directArgs;
  else if (directArgs && typeof directArgs === "object")
    argsString = JSON.stringify(directArgs);
  else if (typeof fn?.arguments === "string") argsString = fn.arguments;

  return {
    id,
    type: "function",
    function: {
      name,
      arguments: argsString,
    },
  };
}

/**
 * Parses chatjimmy's compact `code:json` data protocol lines.
 */
function parseDataProtocolLine(line: string): ParsedUpstreamEvent[] {
  const idx = line.indexOf(":");
  if (idx !== 1) return [];
  const code = line.slice(0, 1) as keyof typeof CODE_MAP;
  const kind = CODE_MAP[code];
  if (!kind) return [];
  const rawPayload = line.slice(2);
  const payload = safeJsonParse(rawPayload);
  if (payload === null) return [];

  if (kind === "text") {
    return typeof payload === "string"
      ? [{ type: "text", delta: payload }]
      : [];
  }

  if (kind === "function_call") {
    if (!payload || typeof payload !== "object") return [];
    const call = normalizeToolCall({
      toolCallId: crypto.randomUUID(),
      toolName:
        (payload as Record<string, unknown>).function_call &&
        typeof (payload as Record<string, unknown>).function_call === "object"
          ? (
              (payload as Record<string, unknown>).function_call as Record<
                string,
                unknown
              >
            ).name
          : undefined,
      args:
        (payload as Record<string, unknown>).function_call &&
        typeof (payload as Record<string, unknown>).function_call === "object"
          ? (
              (payload as Record<string, unknown>).function_call as Record<
                string,
                unknown
              >
            ).arguments
          : "{}",
    });
    return call ? [{ type: "tool_call", call }] : [];
  }

  if (kind === "tool_calls" && payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.tool_calls)) return [];
    return record.tool_calls
      .map((tool) => normalizeToolCall(tool))
      .filter((call): call is OpenAIToolCall => Boolean(call))
      .map((call) => ({ type: "tool_call", call }));
  }

  if (kind === "tool_call") {
    const call = normalizeToolCall(payload);
    return call ? [{ type: "tool_call", call }] : [];
  }

  if (kind === "finish_message" && payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    const finishReason =
      typeof rec.finishReason === "string" ? rec.finishReason : "stop";
    const usageObj =
      rec.usage && typeof rec.usage === "object"
        ? (rec.usage as Record<string, unknown>)
        : null;
    const prompt =
      typeof usageObj?.promptTokens === "number" ? usageObj.promptTokens : 0;
    const completion =
      typeof usageObj?.completionTokens === "number"
        ? usageObj.completionTokens
        : 0;
    return [{ type: "done", finishReason, usage: { prompt, completion } }];
  }

  return [];
}

/**
 * Parses standard `data: ...` SSE lines (OpenAI style).
 */
function parseSseLine(line: string): ParsedUpstreamEvent[] {
  if (!line.startsWith("data:")) return [];
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]")
    return [{ type: "done", finishReason: "stop" }];
  const parsed = safeJsonParse(payload);
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const events: ParsedUpstreamEvent[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const choiceRecord = choice as Record<string, unknown>;
    const delta =
      choiceRecord.delta && typeof choiceRecord.delta === "object"
        ? (choiceRecord.delta as Record<string, unknown>)
        : null;
    if (typeof delta?.content === "string") {
      events.push({ type: "text", delta: delta.content });
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tool of delta.tool_calls) {
        const call = normalizeToolCall(tool);
        if (call) events.push({ type: "tool_call", call });
      }
    }
    if (typeof choiceRecord.finish_reason === "string") {
      events.push({ type: "done", finishReason: choiceRecord.finish_reason });
    }
  }
  return events;
}

/**
 * Convenience parser for one complete chunk string.
 */
export function parseUpstreamChunk(chunk: string): ParsedUpstreamEvent[] {
  const parser = new UpstreamChunkParser();
  return [...parser.parseChunk(chunk), ...parser.flush()];
}

/**
 * Incremental parser for streamed upstream bytes.
 * It buffers partial lines until a newline arrives.
 */
export class UpstreamChunkParser {
  private buffer = "";

  parseChunk(chunk: string): ParsedUpstreamEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    const trailing = lines.pop();
    this.buffer = trailing ?? "";
    const events: ParsedUpstreamEvent[] = [];
    for (const line of lines) events.push(...parseLine(line));
    return events;
  }

  flush(): ParsedUpstreamEvent[] {
    if (!this.buffer) return [];
    const remaining = this.buffer;
    this.buffer = "";
    return parseLine(remaining);
  }
}
