import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
	makeJsonResponse,
	makeTestConfig,
	makeTextStreamResponse,
	readSentAuthorization,
	type FetchLike,
} from "./helpers.js";

describe("chat completions tool and auth behavior", () => {
	const createdApps: ReturnType<typeof buildApp>[] = [];

	afterEach(async () => {
		while (createdApps.length > 0) {
			const app = createdApps.pop();
			if (app) await app.close();
		}
	});

	it("strips tool fields when experimental mode is disabled", async () => {
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
				tool_choice: "none",
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							parameters: {
								type: "object",
								properties: { city: { type: "string" } },
							},
						},
					},
				],
				messages: [{ role: "user", content: "What is weather in Tokyo?" }],
			},
		});

		expect(response.statusCode).toBe(200);
		if (!sentBody) throw new Error("expected upstream request body");
		const sent = sentBody;
		expect(sent["tools"]).toBeUndefined();
		expect(sent["tool_choice"]).toBeUndefined();
	});

	it("rejects required tool choice when experimental mode is disabled", async () => {
		const fetchMock: FetchLike = async () => makeJsonResponse(500, {});
		const app = buildApp({
			fetchImpl: fetchMock,
			config: makeTestConfig({
				experimentalToolUsage: false,
			}),
		});
		createdApps.push(app);

		const response = await app.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				stream: false,
				tool_choice: "required",
				tools: [{ type: "function", function: { name: "get_weather" } }],
				messages: [{ role: "user", content: "Use tool now." }],
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.body).toContain("EXPERIMENTAL_TOOL_USAGE=false");
	});

	it("forwards required tool usage when experimental mode is enabled", async () => {
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
				experimentalToolUsage: true,
			}),
		});
		createdApps.push(app);

		const response = await app.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				stream: false,
				tool_choice: "required",
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							parameters: {
								type: "object",
								properties: { city: { type: "string" } },
							},
						},
					},
				],
				messages: [{ role: "user", content: "Use a tool for weather." }],
			},
		});

		expect(response.statusCode).toBe(200);
		if (!sentBody) throw new Error("expected upstream request body");
		const sent = sentBody;
		expect(Array.isArray(sent["tools"])).toBe(true);
		expect(sent["tool_choice"]).toBe("required");
	});

	it("does not forward wrapper authorization token upstream", async () => {
		let upstreamAuthorization: string | null = null;
		const fetchMock: FetchLike = async (url, init) => {
			if (url.endsWith("/api/chat")) {
				upstreamAuthorization = readSentAuthorization(init);
				return makeTextStreamResponse(["ok"]);
			}
			return makeJsonResponse(404, {});
		};
		const app = buildApp({
			fetchImpl: fetchMock,
			config: makeTestConfig({
				wrapperApiKey: "wrapper-key",
			}),
		});
		createdApps.push(app);

		const response = await app.inject({
			method: "POST",
			url: "/v1/chat/completions",
			headers: {
				authorization: "Bearer wrapper-key",
			},
			payload: {
				stream: false,
				messages: [{ role: "user", content: "hello" }],
			},
		});

		expect(response.statusCode).toBe(200);
		expect(upstreamAuthorization).toBeNull();
	});

	it("uses configured upstream api key when provided", async () => {
		let upstreamAuthorization: string | null = null;
		const fetchMock: FetchLike = async (url, init) => {
			if (url.endsWith("/api/chat")) {
				upstreamAuthorization = readSentAuthorization(init);
				return makeTextStreamResponse(["ok"]);
			}
			return makeJsonResponse(404, {});
		};
		const app = buildApp({
			fetchImpl: fetchMock,
			config: makeTestConfig({
				upstreamApiKey: "upstream-key",
			}),
		});
		createdApps.push(app);

		const response = await app.inject({
			method: "POST",
			url: "/v1/chat/completions",
			headers: {
				authorization: "Bearer ignored-client-key",
			},
			payload: {
				stream: false,
				messages: [{ role: "user", content: "hello" }],
			},
		});

		expect(response.statusCode).toBe(200);
		expect(upstreamAuthorization).toBe("Bearer upstream-key");
	});
});
