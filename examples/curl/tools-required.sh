#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:=http://127.0.0.1:8787}"
: "${API_KEY:=local-wrapper-key}"

# If EXPERIMENTAL_TOOL_USAGE=false, this returns HTTP 400 by design.
curl -sS -N \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "model":"llama3.1-8B",
    "stream":true,
    "tool_choice":"required",
    "tools":[
      {
        "type":"function",
        "function":{
          "name":"get_weather",
          "description":"Get weather for a city",
          "parameters":{
            "type":"object",
            "properties":{"city":{"type":"string"}},
            "required":["city"]
          }
        }
      }
    ],
    "messages":[{"role":"user","content":"Use a tool to get weather in Tokyo."}]
  }' \
  "${BASE_URL}/v1/chat/completions"

