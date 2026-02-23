import type { AppConfig } from "../config.js";

export interface IncomingForwardHeaders {
	authorization?: string;
	cookie?: string;
}

export type UpstreamForwardHeaders = Record<string, string>;

/**
 * Extracts the bearer token value from an Authorization header.
 * Returns `null` when header is missing or not Bearer format.
 */
function parseBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
		return null;
	}
	return authHeader.slice(7).trim();
}

/**
 * Chooses which Authorization header should be sent upstream.
 * Priority:
 * 1) explicit `UPSTREAM_API_KEY`
 * 2) incoming user auth header (unless it is the local wrapper key)
 */
export function resolveUpstreamAuthorization(
	incomingAuthorization: string | undefined,
	config: AppConfig,
): string | undefined {
	if (config.upstreamApiKey) {
		return `Bearer ${config.upstreamApiKey}`;
	}
	if (!incomingAuthorization) return undefined;

	// Never leak the local wrapper key to the upstream provider.
	if (config.wrapperApiKey) {
		const incomingToken = parseBearerToken(incomingAuthorization);
		if (incomingToken && incomingToken === config.wrapperApiKey) {
			return undefined;
		}
	}

	return incomingAuthorization;
}

/**
 * Builds the final auth/cookie headers forwarded to upstream APIs.
 */
export function buildUpstreamForwardHeaders(
	incoming: IncomingForwardHeaders,
	config: AppConfig,
): UpstreamForwardHeaders {
	const forwarded: UpstreamForwardHeaders = {};
	const authorization = resolveUpstreamAuthorization(
		incoming.authorization,
		config,
	);
	if (authorization) forwarded.authorization = authorization;
	if (incoming.cookie) forwarded.cookie = incoming.cookie;
	return forwarded;
}
