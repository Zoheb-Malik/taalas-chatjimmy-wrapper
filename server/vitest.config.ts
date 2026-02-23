import { defineConfig } from "vitest/config";

export default defineConfig({
	root: ".",
	test: {
		environment: "node",
		include: ["server/test/**/*.spec.ts"],
	},
});
