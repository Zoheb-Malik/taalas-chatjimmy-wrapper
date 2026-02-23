#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:=http://127.0.0.1:8787}"
: "${API_KEY:=local-wrapper-key}"

curl -sS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{
    "model":"llama3.1-8B",
    "messages":[{"role":"user","content":"Say hello in one sentence."}]
  }' \
  "${BASE_URL}/v1/chat/completions"

