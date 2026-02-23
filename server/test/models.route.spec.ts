import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makeJsonResponse, type FetchLike } from "./helpers.js";

describe("models route", () => {
	const createdApps: ReturnType<typeof buildApp>[] = [];

	afterEach(async () => {
		while (createdApps.length > 0) {
			const app = createdApps.pop();
			if (app) await app.close();
		}
	});

	it("maps upstream models to OpenAI list and preserves metadata", async () => {
		const fetchMock: FetchLike = async (url) => {
			if (url.endsWith("/api/models")) {
				return makeJsonResponse(200, {
					data: [
						{
							id: "llama3.1-8B",
							created: 1690000000,
							owned_by: "Taalas Inc.",
						},
					],
				});
			}
			return makeJsonResponse(404, {});
		};
		const app = buildApp({ fetchImpl: fetchMock });
		createdApps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/v1/models",
		});

		expect(response.statusCode).toBe(200);
		const payload = response.json();
		expect(payload.object).toBe("list");
		expect(payload.data[0].id).toBe("llama3.1-8B");
		expect(payload.data[0].object).toBe("model");
		expect(payload.data[0].created).toBe(1690000000);
		expect(payload.data[0].owned_by).toBe("Taalas Inc.");
	});

	it("passes through upstream non-ok models response", async () => {
		const fetchMock: FetchLike = async (url) => {
			if (url.endsWith("/api/models")) {
				return makeJsonResponse(429, { message: "Rate limited upstream" });
			}
			return makeJsonResponse(404, {});
		};
		const app = buildApp({ fetchImpl: fetchMock });
		createdApps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/v1/models",
		});

		expect(response.statusCode).toBe(429);
		expect(response.body).toContain("Rate limited upstream");
	});
});
