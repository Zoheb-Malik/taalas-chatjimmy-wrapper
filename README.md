# Taalas ChatJimmy AI OpenAI-Compatible Wrapper (Unofficial)

This project is an unofficial OpenAI-compatible wrapper in front of `https://chatjimmy.ai` for the llama-3.1:8B model, which aims to deliver ~17,000 tokens per second, per user.

<p align="center">
  <img src="https://taalas.com/h-content/uploads/2026/02/graph.png" alt="Performance graph" width="500" />
</p>

## Important Disclaimer

- This is an **unofficial** community project.
- It is **not affiliated with, endorsed by, or supported by Taalas**.
- It is **not an official ChatJimmy or Taalas SDK/API package**.
- The compatibility details in this README are based on public docs and expected OpenAI-compatible behavior; not every workflow in every tool has been fully end-to-end tested in this repo.

## Project Purpose

The goal is to make integration simpler when you already have OpenAI-compatible clients in place.
Instead of rewriting your app for a different API shape, you can point existing OpenAI client code to this wrapper and keep using familiar routes and payload patterns.

In short: **compatibility layer + guardrails + translation**.

This project is also an experiment to stretch practical inference limits: test how far OpenAI-compatible tooling can go, how quickly tokens can be delivered, and what real-world developer workflows look like when optimized for low-latency throughput.

Hardware/platform context for upstream exploration:

- Taalas HC1 runs Llama 3.1 8B.
- Process: TSMC 6nm
- Die size: 815 mm^2
- Transistors: 53B
- Server power: 2.5 kW

## What You Can Do With It

- Keep using OpenAI-style endpoints:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Use existing OpenAI SDKs (Node.js/Python) against this local service.
- Run both non-streaming and streaming chat completions.
- Apply request validation and consistent OpenAI-style error responses.
- Enforce wrapper-level auth with `WRAPPER_API_KEY`.
- Control payload behavior with limits and tool usage flags.

## How It Works (High Level)

1. Your client sends an OpenAI-style request to this wrapper.
2. The wrapper validates and normalizes the request.
3. The wrapper transforms and forwards the request to `https://chatjimmy.ai`.
4. The upstream response is normalized back to OpenAI-style output.
5. If streaming is enabled, the wrapper emits OpenAI-style SSE chunks.

## Requirements

- Node.js 20+
- pnpm

## Quick Start (5 Minutes)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Create `.env`

```bash
UPSTREAM_BASE_URL=https://chatjimmy.ai
UPSTREAM_API_KEY=
EXPERIMENTAL_TOOL_USAGE=false
UPSTREAM_TIMEOUT_MS=15000
UPSTREAM_MAX_RETRIES=2
HOST=127.0.0.1
PORT=8787
DEFAULT_STREAM=false
WRAPPER_API_KEY=local-wrapper-key
BODY_LIMIT_MB=25
UPSTREAM_PREFILL_TOKEN_LIMIT=6064
UPSTREAM_REQUEST_BYTE_LIMIT=1200000
```

### 3) Start the wrapper

```bash
pnpm server:start
```

### 4) Verify it is healthy

```bash
curl -sS http://127.0.0.1:8787/health
```

Expected:

```json
{ "ok": true }
```

## Important Defaults

- `stream` uses `DEFAULT_STREAM` when omitted (default: `false`).
- `EXPERIMENTAL_TOOL_USAGE` is `false` by default.
- If `WRAPPER_API_KEY` is set, callers must send `Authorization: Bearer <key>`.
- If `UPSTREAM_API_KEY` is set, that key is used for upstream calls.

## Working Examples (Copy/Paste)

Set these once in your shell:

```bash
export BASE_URL="http://127.0.0.1:8787"
export API_KEY="local-wrapper-key"
```

### Example A: List Models

```bash
curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/models" | jq
```

### Example B: Chat Completion (Non-Stream)

```bash
curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "model":"llama3.1-8B",
    "messages":[{"role":"user","content":"Say hello in one sentence."}]
  }' \
  "$BASE_URL/v1/chat/completions" | jq
```

### Example C: Chat Completion (Stream)

```bash
curl -sS -N \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "model":"llama3.1-8B",
    "stream":true,
    "messages":[{"role":"user","content":"Count from 1 to 3."}]
  }' \
  "$BASE_URL/v1/chat/completions"
```

You should see multiple `data: {...}` lines and a final `data: [DONE]`.

### Example D: Run Bundled curl Scripts

```bash
bash examples/curl/models.sh
bash examples/curl/chat-non-stream.sh
bash examples/curl/chat-stream.sh
bash examples/curl/tools-required.sh
```

### Example E: Node.js OpenAI SDK

```bash
pnpm examples:node
```

### Example F: Python OpenAI SDK

```bash
pnpm examples:python
```

## Optional: Expose the Wrapper Remotely (Cloudflare Tunnel, etc.)

If you want to access this wrapper from another device or share it with collaborators, you can expose your local server through a secure tunnel (for example, Cloudflare Tunnel).

Example with `cloudflared`:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Then use the generated public URL as your client base URL (append `/v1` in SDK configs).

Security advice when exposing publicly:

- Always set a strong `WRAPPER_API_KEY` and require bearer auth.
- Rotate keys if they are ever shared or leaked.
- Restrict access (for example with Cloudflare Access, allowlists, or private networking) when possible.
- Monitor logs and shut down the tunnel when not needed.

## AI Tool Compatibility (Unverified)

This endpoint is designed for tools that support OpenAI-compatible APIs and a configurable base URL.
Set the tool's base URL to `http://127.0.0.1:8787/v1` and use your `WRAPPER_API_KEY` (if enabled) as the API key.

### Major Tools and How to Use This Endpoint

- OpenAI SDKs (Node.js/Python): support custom base URL configuration; point them to this wrapper to run chat completions and streaming from existing OpenAI-style code. Docs: `https://github.com/openai/openai-node` and `https://github.com/openai/openai-python`
- Anthropic / Claude ecosystem: Anthropic documents OpenAI SDK compatibility for calling Claude through OpenAI SDK syntax; this confirms OpenAI-compatible workflows are widely supported, but for full Claude features Anthropic recommends native Claude API. Docs: `https://docs.anthropic.com/en/api/openai-sdk`
- LangChain (`ChatOpenAI`): supports `base_url`; use this wrapper as a drop-in chat backend for chains/agents that use OpenAI-compatible chat completions. Docs: `https://docs.langchain.com/oss/python/integrations/chat/openai`
- LiteLLM: supports OpenAI-compatible endpoints via `api_base`; use this wrapper as one routed provider in a multi-model gateway setup. Docs: `https://docs.litellm.ai/docs/providers/openai_compatible`
- Open WebUI: explicitly supports OpenAI-compatible backends; connect this endpoint in provider settings and chat through WebUI with model selection and streaming UI. Docs: `https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/`
- OpenCode: supports provider `options.baseURL` and OpenAI-compatible providers; configure it to route coding/chat tasks to this wrapper endpoint. Docs: `https://opencode.ai/docs/providers`
- Continue: supports OpenAI-compatible providers using `apiBase`; use this wrapper for IDE inline chat/completions with OpenAI-style model config. Docs: `https://docs.continue.dev/customize/model-providers/top-level/openai`
- Cline: has an "OpenAI Compatible" provider mode with configurable Base URL; connect this endpoint to run coding-agent workflows against your wrapper. Docs: `https://docs.cline.bot/provider-config/openai-compatible`
- OpenHands: documents OpenAI-compatible endpoint usage via LiteLLM and configurable Base URL; connect this wrapper for agentic coding sessions. Docs: `https://docs.openhands.dev/openhands/usage/llms/openai-llms`
- Aider: has official OpenAI-compatible endpoint support via `OPENAI_API_BASE` and `openai/<model>` naming; use this wrapper for repo-aware CLI coding assistance. Docs: `https://aider.chat/docs/llms/openai-compat.html`
- Open Interpreter: supports any OpenAI-compatible server using `api_base`; use this wrapper as the model backend for CLI/local assistant workflows. Docs: `https://docs.openinterpreter.com/language-models/local-models/custom-endpoint`
- OpenAI Codex CLI: config reference documents custom `model_providers.*.base_url`; can be configured to call OpenAI-compatible providers. Docs: `https://developers.openai.com/codex/config-reference/`
- Vercel AI SDK ecosystem: includes `@ai-sdk/openai-compatible` and configurable `baseURL`, useful for apps and custom providers built on AI SDK. Docs: `https://sdk.vercel.ai/providers/openai-compatible-providers/custom-providers`

### What You Can Accomplish Across Tools

- Reuse existing OpenAI-style client code without rewriting request/response formats.
- Run local or team-shared OpenAI-compatible endpoints with wrapper-level auth and policy controls.
- Use the same backend across SDKs, CLIs, UI tools, IDE assistants, and automation frameworks.
- Stream responses in tools that support SSE chat streaming.
- Standardize error format and request validation before traffic reaches upstream services.

### Compatibility Notes

- Best compatibility requires `/v1/chat/completions` and `/v1/models` behavior aligned with common OpenAI expectations.
- Some tools expect `/v1/models` for auto-discovery; if discovery fails, manually enter model IDs where supported.
- Tool/function-calling behavior varies by tool and upstream model capability.
- This list is broad, not exhaustive; any client that supports OpenAI-compatible base URLs may work.
- Some specific provider features (for example: proprietary reasoning fields, multimodal edge cases, or advanced tool semantics) remain unverified with this wrapper.

## Behavior Notes for Tools

- With `EXPERIMENTAL_TOOL_USAGE=false`, tool fields are removed before upstream forwarding.
- If a request requires tools (`tool_choice: "required"`) while disabled, expect `400`.
- With `EXPERIMENTAL_TOOL_USAGE=true`, behavior is best-effort and still depends on upstream capabilities.

## Troubleshooting

- `401 Missing bearer token`: `WRAPPER_API_KEY` is set but auth header is missing.
- `413 Request body is too large`: reduce payload size or increase `BODY_LIMIT_MB`.
- `422 Upstream returned an empty response`: reduce context size or lower `UPSTREAM_PREFILL_TOKEN_LIMIT`.
- `400 Tool usage is disabled`: set `EXPERIMENTAL_TOOL_USAGE=true` and restart.

## Scripts

- `pnpm start`: start server via `pnpm server:start`
- `pnpm check`: typecheck + full tests
- `pnpm typecheck`: TypeScript type-check only
- `pnpm test`: run full test suite
- `pnpm test:tools`: run tool-focused tests only
- `pnpm examples:curl:all`: run core curl demos
- `pnpm examples:node`: run Node SDK demo
- `pnpm examples:python`: run Python SDK demo

## Contributing

External contributions are welcome.

- Read `docs/CONTRIBUTING.md` before opening a pull request.
- Follow `docs/SECURITY.md` for vulnerability reporting (do not post exploits in public issues).
- PRs are expected to pass required checks (format, typecheck, tests, and security workflows) before merge.

## Important Notice

This project is provided for research and educational purposes only. It is provided "as is", without warranties of any kind, express or implied, and the authors and contributors are not liable for any direct, indirect, incidental, special, exemplary, or consequential damages arising from use or misuse of this project. You are solely responsible for compliance with all applicable laws, terms of service, and third-party platform/provider policies. This is an unofficial community project and is not affiliated with, endorsed by, or supported by Taalas or ChatJimmy.
