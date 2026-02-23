import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { getConfig, type AppConfig } from "./config.js";
import {
	ChatJimmyClient,
	type FetchLike,
} from "./upstream/chatjimmy-client.js";
import { registerModelsRoute } from "./routes/models.js";
import { registerChatCompletionsRoute } from "./routes/chat-completions.js";
import { buildOpenAIError } from "./transform/upstream-to-openai.js";

export interface AppDependencies {
	fetchImpl?: FetchLike;
	config?: AppConfig;
}

/**
 * Validates incoming wrapper auth against `WRAPPER_API_KEY`.
 * If no wrapper key is configured, all requests are allowed.
 */
function authorizeRequest(
	authHeader: string | undefined,
	wrapperApiKey: string | undefined,
): { allowed: boolean; reason?: string } {
	if (!wrapperApiKey) return { allowed: true };
	if (!authHeader?.toLowerCase().startsWith("bearer ")) {
		return { allowed: false, reason: "Missing bearer token." };
	}
	const token = authHeader.slice(7).trim();
	if (token !== wrapperApiKey) {
		return { allowed: false, reason: "Invalid API key." };
	}
	return { allowed: true };
}

/**
 * Builds the Fastify app with routes, auth guard, logging, and error mapping.
 * This app exposes OpenAI-compatible endpoints backed by chatjimmy upstream APIs.
 */
export function buildApp(deps: AppDependencies = {}): FastifyInstance {
	const config = deps.config ?? getConfig();
	const app = Fastify({ logger: true, bodyLimit: config.bodyLimitBytes });
	const client = new ChatJimmyClient({
		baseUrl: config.upstreamBaseUrl,
		timeoutMs: config.requestTimeoutMs,
		retries: config.maxRetries,
		fetchImpl: deps.fetchImpl,
	});

	app.register(cors, { origin: true, credentials: true });

	app.addHook("preHandler", async (request) => {
		const maybeBody =
			request.body && typeof request.body === "object"
				? (request.body as Record<string, unknown>)
				: undefined;
		const authHeader = request.headers.authorization;
		const hasAuth = Boolean(authHeader);
		const authType = authHeader?.split(" ")[0] ?? "none";
		const bodySummary = maybeBody
			? {
					keys: Object.keys(maybeBody),
					hasMessages: Array.isArray(maybeBody.messages),
					messageCount: Array.isArray(maybeBody.messages)
						? maybeBody.messages.length
						: 0,
					stream:
						typeof maybeBody.stream === "boolean"
							? maybeBody.stream
							: undefined,
					model:
						typeof maybeBody.model === "string" ? maybeBody.model : undefined,
				}
			: undefined;

		request.log.info(
			{
				event: "incoming_request_detailed",
				method: request.method,
				url: request.url,
				remoteAddress: request.ip,
				host: request.hostname,
				hasAuth,
				authType,
				bodySummary,
			},
			"request details",
		);
	});

	app.addHook("onRequest", async (request, reply) => {
		request.log.info(
			{
				event: "incoming_request_meta",
				method: request.method,
				url: request.url,
				contentLength: request.headers["content-length"],
				contentType: request.headers["content-type"],
				userAgent: request.headers["user-agent"],
				remoteAddress: request.ip,
			},
			"request metadata",
		);

		if (request.url === "/health") return;
		const auth = authorizeRequest(
			request.headers.authorization,
			config.wrapperApiKey,
		);
		if (!auth.allowed) {
			request.log.warn(
				{
					event: "auth_rejected",
					url: request.url,
					reason: auth.reason,
					hasAuthHeader: Boolean(request.headers.authorization),
				},
				"authentication rejected",
			);
			const out = buildOpenAIError(401, auth.reason ?? "Unauthorized");
			return reply.code(out.status).send(out.body);
		}
	});

	app.setErrorHandler((error, request, reply) => {
		const maybeError = error as { code?: string };
		if (maybeError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
			request.log.warn(
				{
					event: "request_body_too_large",
					url: request.url,
					contentLength: request.headers["content-length"],
					bodyLimitBytes: config.bodyLimitBytes,
					errorCode: maybeError.code,
				},
				"request body exceeded configured body limit",
			);
			const out = buildOpenAIError(
				413,
				`Request body is too large. Increase BODY_LIMIT_MB (current ${(config.bodyLimitBytes / (1024 * 1024)).toFixed(0)}MB).`,
			);
			return reply.code(out.status).send(out.body);
		}

		request.log.error(
			{
				event: "unhandled_request_error",
				error,
				url: request.url,
			},
			"unhandled request error",
		);
		return reply
			.code(500)
			.send(buildOpenAIError(500, "Internal server error").body);
	});

	app.get("/health", async () => ({ ok: true }));
	registerModelsRoute(app, client, config);
	registerChatCompletionsRoute(app, client, config);
	return app;
}
