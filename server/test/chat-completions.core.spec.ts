import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  makeJsonResponse,
  makeTestConfig,
  makeTextStreamResponse,
  type FetchLike,
} from "./helpers.js";

describe("chat completions core behavior", () => {
  const createdApps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (createdApps.length > 0) {
      const app = createdApps.pop();
      if (app) await app.close();
    }
  });

  it("returns 400 for invalid request body", async () => {
    const fetchMock: FetchLike = async () => makeJsonResponse(500, {});
    const app = buildApp({ fetchImpl: fetchMock });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("messages array is required");
  });

  it("returns non-stream chat completion with usage", async () => {
    const fetchMock: FetchLike = async (url) => {
      if (url.endsWith("/api/chat")) {
        return makeTextStreamResponse([
          "Hello from Jimmy",
          '<|stats|>{"prefill_tokens":4,"decode_tokens":7}<|/stats|>',
        ]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({ fetchImpl: fetchMock });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama3.1-8B",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.object).toBe("chat.completion");
    expect(payload.choices[0].message.content).toContain("Hello from Jimmy");
    expect(payload.usage.total_tokens).toBe(11);
  });

  it("defaults to non-stream mode when stream is omitted", async () => {
    const fetchMock: FetchLike = async (url) => {
      if (url.endsWith("/api/chat")) {
        return makeTextStreamResponse([
          "Default non-stream response",
          '<|stats|>{"prefill_tokens":3,"decode_tokens":5}<|/stats|>',
        ]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({ fetchImpl: fetchMock });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama3.1-8B",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.object).toBe("chat.completion");
    expect(payload.choices[0].message.content).toContain(
      "Default non-stream response",
    );
  });

  it("uses configured default stream mode when stream is omitted", async () => {
    const fetchMock: FetchLike = async (url) => {
      if (url.endsWith("/api/chat")) {
        return makeTextStreamResponse([
          '0:"configured stream response"\n',
          '<|stats|>{"prefill_tokens":2,"decode_tokens":3,"done_reason":"stop"}<|/stats|>\n',
        ]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({
      fetchImpl: fetchMock,
      config: makeTestConfig({ defaultStream: true }),
    });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama3.1-8B",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain('"content":"configured stream response"');
    expect(response.body).toContain("data: [DONE]");
  });

  it("includes stream usage only when requested and parses trailing stats", async () => {
    const fetchMock: FetchLike = async (url) => {
      if (url.endsWith("/api/chat")) {
        return makeTextStreamResponse([
          '0:"ok"\n',
          '<|stats|>{"prefill_tokens":4,"decode_tokens":7,"done_reason":"stop"}<|/stats|>\n',
        ]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({ fetchImpl: fetchMock });
    createdApps.push(app);

    const withoutUsage = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const withUsage = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(withoutUsage.body).not.toContain('"usage"');
    expect(withUsage.body).toContain('"prompt_tokens":4');
    expect(withUsage.body).toContain('"completion_tokens":7');
  });

  it("trims oversized prompt history before upstream request", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock: FetchLike = async (url, init) => {
      if (url.endsWith("/api/chat")) {
        const raw = typeof init?.body === "string" ? init.body : "{}";
        sentBody = JSON.parse(raw) as Record<string, unknown>;
        return makeTextStreamResponse(["ok"]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({
      fetchImpl: fetchMock,
      config: makeTestConfig({
        prefillTokenLimit: 40,
      }),
    });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        stream: false,
        messages: [
          { role: "user", content: "A".repeat(100) },
          { role: "assistant", content: "B".repeat(100) },
          { role: "user", content: "C".repeat(100) },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    if (!sentBody) throw new Error("expected upstream request body");
    const sent = sentBody;
    const sentMessages = (sent["messages"] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(sentMessages.length).toBeLessThan(3);
    expect(
      String(sentMessages[sentMessages.length - 1]?.content ?? ""),
    ).toContain("C");
  });

  it("normalizes array-form message content", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock: FetchLike = async (url, init) => {
      if (url.endsWith("/api/chat")) {
        const raw = typeof init?.body === "string" ? init.body : "{}";
        sentBody = JSON.parse(raw) as Record<string, unknown>;
        return makeTextStreamResponse(["ok"]);
      }
      return makeJsonResponse(404, {});
    };
    const app = buildApp({ fetchImpl: fetchMock });
    createdApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        stream: false,
        messages: [
          {
            role: "system",
            content: [{ type: "text", text: "Use tools when needed." }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "List files in project root." }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    if (!sentBody) throw new Error("expected upstream request body");
    const sent = sentBody;
    const chatOptions = (sent["chatOptions"] ?? {}) as Record<string, unknown>;
    expect(chatOptions.systemPrompt).toBe("Use tools when needed.");
    const sentMessages = (sent["messages"] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(sentMessages[0]?.content).toBe("List files in project root.");
  });
});
