import type { AppConfig } from "../src/config.js";
import type {
  FetchLike,
  HttpLikeResponse,
} from "../src/upstream/chatjimmy-client.js";

export function makeJsonResponse(
  status: number,
  body: unknown,
): HttpLikeResponse {
  const textBody = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return JSON.parse(textBody) as unknown;
    },
    async text() {
      return textBody;
    },
    body: null,
  };
}

export function makeTextStreamResponse(chunks: string[]): HttpLikeResponse {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/plain" }),
    async json() {
      return {};
    },
    async text() {
      return chunks.join("");
    },
    body: stream,
  };
}

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    upstreamBaseUrl: "https://chatjimmy.ai",
    defaultStream: false,
    experimentalToolUsage: false,
    requestTimeoutMs: 15000,
    maxRetries: 0,
    bodyLimitBytes: 25 * 1024 * 1024,
    prefillTokenLimit: 6064,
    upstreamRequestByteLimit: 1200000,
    ...overrides,
  };
}

export function readSentAuthorization(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("authorization");
}

export type { FetchLike };
