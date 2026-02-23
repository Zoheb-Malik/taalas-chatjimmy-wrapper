import OpenAI from "openai";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.API_KEY ?? "local-wrapper-key";

const client = new OpenAI({
	apiKey,
	baseURL: `${baseURL}/v1`,
});

async function run() {
	const models = await client.models.list();
	console.log(
		"models:",
		models.data.map((m) => m.id),
	);

	const nonStream = await client.chat.completions.create({
		model: "llama3.1-8B",
		messages: [{ role: "user", content: "Explain wrappers in one line." }],
	});
	console.log("\n--- non-stream response ---");
	console.log(nonStream.choices[0]?.message?.content ?? "(no content)");

	const stream = await client.chat.completions.create({
		model: "llama3.1-8B",
		stream: true,
		messages: [
			{
				role: "user",
				content:
					"Count from 1 to 26 and map each number to A-Z, one item per line.",
			},
		],
	});
	process.stdout.write("\n--- stream response ---\n");
	for await (const chunk of stream) {
		const text = chunk.choices[0]?.delta?.content ?? "";
		if (text) process.stdout.write(text);
	}
	process.stdout.write("\n--- end stream ---\n");
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
