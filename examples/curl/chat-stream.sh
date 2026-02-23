#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:=http://127.0.0.1:8787}"
: "${API_KEY:=local-wrapper-key}"

curl -sS -N \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "model":"llama3.1-8B",
    "stream":true,
    "messages":[{"role":"user","content":"Count from 1 to 5."}]
  }' \
  "${BASE_URL}/v1/chat/completions"

