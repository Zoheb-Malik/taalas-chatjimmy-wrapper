import os

from openai import OpenAI

BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8787")
API_KEY = os.getenv("API_KEY", "local-wrapper-key")

client = OpenAI(
    api_key=API_KEY,
    base_url=f"{BASE_URL}/v1",
)

models = client.models.list()
print("models:", [m.id for m in models.data])

resp = client.chat.completions.create(
    model="llama3.1-8B",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
)
print("\n--- non-stream response ---")
print(resp.choices[0].message.content or "(no content)")

stream = client.chat.completions.create(
    model="llama3.1-8B",
    stream=True,
    messages=[
        {
            "role": "user",
            "content": "Count from 1 to 26 and map each number to A-Z, one item per line.",
        }
    ],
)
print("\n--- stream response ---")
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    if delta:
        print(delta, end="")
print("\n--- end stream ---")
