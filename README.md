# Taalas ChatJimmy AI OpenAI-Compatible Wrapper (Unofficial)

Lightweight OpenAI-compatible wrapper for `https://chatjimmy.ai` by Taalas (`llama3.1-8B`).
Use it to point existing OpenAI SDK/client integrations without rewriting API calls.

<p align="center">
  <img src="https://taalas.com/h-content/uploads/2026/02/graph.png" alt="Performance graph" width="500" />
</p>

## Disclaimer

- Community project; not official.
- Not affiliated with, endorsed by, or supported by Taalas or ChatJimmy.
- Compatibility is best-effort.

## Features

- OpenAI-style endpoints:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Streaming + non-streaming completions
- Request validation and OpenAI-style error formatting
- Optional wrapper auth with `WRAPPER_API_KEY`
- Configurable payload/tool guardrails

## Requirements

- Node.js 20+
- pnpm

## Quick Start

1. Install:

```bash
pnpm install
```

2. Create `.env`:

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

3. Start:

```bash
pnpm server:start
```

4. Check health:

```bash
curl -sS http://127.0.0.1:8787/health
```

Expected:

```json
{ "ok": true }
```

## Usage

Set shell vars:

```bash
export BASE_URL="http://127.0.0.1:8787"
export API_KEY="local-wrapper-key"
```

List models:

```bash
curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/models" | jq
```

Chat completion (non-stream):

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

Chat completion (stream):

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

Run bundled examples:

```bash
pnpm examples:curl:all
pnpm examples:node
pnpm examples:python
```

## Defaults & Behavior

- `stream` defaults to `DEFAULT_STREAM` when omitted.
- If `WRAPPER_API_KEY` is set, `Authorization: Bearer <key>` is required.
- If `UPSTREAM_API_KEY` is set, it is used for upstream requests.
- With `EXPERIMENTAL_TOOL_USAGE=false`, tool fields are stripped before forwarding.
- `tool_choice: "required"` returns `400` when tools are disabled.

## Scripts

- `pnpm start` - Start server
- `pnpm check` - Typecheck + tests
- `pnpm typecheck` - TypeScript type-check only
- `pnpm test` - Test suite
- `pnpm test:tools` - Tool-focused tests

## Troubleshooting

- `401 Missing bearer token`: set header or unset `WRAPPER_API_KEY`.
- `413 Request body is too large`: reduce payload or increase `BODY_LIMIT_MB`.
- `422 Upstream returned an empty response`: reduce context size or lower `UPSTREAM_PREFILL_TOKEN_LIMIT`.
- `400 Tool usage is disabled`: set `EXPERIMENTAL_TOOL_USAGE=true` and restart.

## Contributing

- See `docs/CONTRIBUTING.md`.
- Report vulnerabilities via `docs/SECURITY.md`.
