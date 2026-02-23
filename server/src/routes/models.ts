import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { ChatJimmyClient } from "../upstream/chatjimmy-client.js";
import type { ChatJimmyModelsResponse } from "../types.js";
import { buildOpenAIError } from "../transform/upstream-to-openai.js";
import { buildUpstreamForwardHeaders } from "../upstream/forward-headers.js";

/**
 * Registers `/v1/models` in OpenAI format by mapping upstream model metadata.
 */
export function registerModelsRoute(
  app: FastifyInstance,
  client: ChatJimmyClient,
  config: AppConfig,
): void {
  app.get("/v1/models", async (request, reply) => {
    try {
      const upstream = await client.getModels(
        buildUpstreamForwardHeaders(
          {
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
          },
          config,
        ),
      );
      app.log.info(
        {
          event: "upstream_models_response",
          status: upstream.status,
          statusText: upstream.statusText,
        },
        "received upstream models response",
      );
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "Upstream error");
        app.log.error(
          {
            event: "upstream_models_non_ok",
            status: upstream.status,
            statusText: upstream.statusText,
            errorText: text,
          },
          "upstream models returned non-ok status",
        );
        const out = buildOpenAIError(
          upstream.status,
          text || upstream.statusText || "Failed to fetch upstream models",
        );
        return reply.code(out.status).send(out.body);
      }
      const payload = (await upstream.json()) as ChatJimmyModelsResponse;
      const data = Array.isArray(payload.data) ? payload.data : [];
      const models = data.map((model) => ({
        id: typeof model.id === "string" ? model.id : "unknown-model",
        object: "model",
        created:
          typeof model.created === "number"
            ? model.created
            : Math.floor(Date.now() / 1000),
        owned_by:
          typeof model.owned_by === "string" ? model.owned_by : "chatjimmy",
      }));
      app.log.info(
        {
          event: "models_mapped",
          modelCount: models.length,
          modelIds: models.map((m) => m.id),
        },
        "mapped upstream models to OpenAI format",
      );
      return reply.send({
        object: "list",
        data: models,
      });
    } catch (error) {
      app.log.error({ error }, "failed to fetch models");
      const out = buildOpenAIError(502, "Failed to fetch upstream models");
      return reply.code(out.status).send(out.body);
    }
  });
}
