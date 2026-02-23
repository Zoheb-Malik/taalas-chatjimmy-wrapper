# Examples

These demos show how to call the local wrapper using curl and OpenAI SDK clients.

## Prerequisites

- Wrapper running locally (`pnpm server:dev`)
- `BASE_URL` and `API_KEY` exported in your shell

```bash
export BASE_URL="http://127.0.0.1:8787"
export API_KEY="local-wrapper-key"
```

## Files

- `curl/models.sh` - list models
- `curl/chat-non-stream.sh` - normal chat completion (`stream` omitted, defaults to false)
- `curl/chat-stream.sh` - streaming chat completion (`stream: true`)
- `curl/tools-required.sh` - tool-call request example (`tool_choice: required`)
- `node/openai-sdk.mjs` - Node.js OpenAI SDK demo
- `python/openai_sdk.py` - Python OpenAI SDK demo

## Run

```bash
bash examples/curl/models.sh
bash examples/curl/chat-non-stream.sh
bash examples/curl/chat-stream.sh
bash examples/curl/tools-required.sh
```

Node demo:

```bash
npm i openai
node examples/node/openai-sdk.mjs
```

Python demo:

```bash
python3 -m pip install openai
python3 examples/python/openai_sdk.py
```
