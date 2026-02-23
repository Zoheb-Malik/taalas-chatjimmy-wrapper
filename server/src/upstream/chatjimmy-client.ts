import { setTimeout as delay } from "node:timers/promises";

export interface HttpLikeResponse {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Headers;
	json(): Promise<unknown>;
	text(): Promise<string>;
	body: ReadableStream<Uint8Array> | null;
}

export type FetchLike = (
	input: string,
	init?: RequestInit,
) => Promise<HttpLikeResponse>;

export interface ChatJimmyClientConfig {
	baseUrl: string;
	timeoutMs: number;
	retries: number;
	fetchImpl?: FetchLike;
}

export type ForwardHeaders = Record<string, string>;

/**
 * Small HTTP client for `chatjimmy.ai` with timeout + retry behavior.
 * It keeps all upstream request rules in one place.
 */
export class ChatJimmyClient {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private readonly fetchImpl: FetchLike;

	constructor(config: ChatJimmyClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.timeoutMs = config.timeoutMs;
		this.retries = config.retries;
		this.fetchImpl = config.fetchImpl ?? (fetch as FetchLike);
	}

	/**
	 * Fetches upstream model metadata from `/api/models`.
	 */
	async getModels(headers: ForwardHeaders = {}): Promise<HttpLikeResponse> {
		return this.request("/api/models", {
			method: "GET",
			headers,
			cache: "no-store",
		});
	}

	/**
	 * Sends a chat payload to upstream `/api/chat`.
	 */
	async postChat(
		body: unknown,
		headers: ForwardHeaders = {},
	): Promise<HttpLikeResponse> {
		return this.request("/api/chat", {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	/**
	 * Executes one upstream request with retry and timeout handling.
	 * Retries are only for transport failures, not HTTP status codes.
	 */
	private async request(
		path: string,
		init: RequestInit,
	): Promise<HttpLikeResponse> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.retries; attempt += 1) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
			try {
				const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
					...init,
					signal: controller.signal,
				});
				clearTimeout(timeout);
				return response;
			} catch (error) {
				clearTimeout(timeout);
				lastError = error;
				if (attempt < this.retries) {
					await delay(200 * (attempt + 1));
					continue;
				}
			}
		}
		throw lastError;
	}
}
