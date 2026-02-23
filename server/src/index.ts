import { buildApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const app = buildApp({ config });

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(
      `openai wrapper listening on http://${config.host}:${config.port} -> ${config.upstreamBaseUrl}`,
    );
  })
  .catch((error) => {
    app.log.error(error, "failed to start server");
    process.exit(1);
  });
