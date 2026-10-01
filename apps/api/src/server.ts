import { DEFAULT_API_PORT } from "@disaster/config";
import { createApp } from "./app.js";

const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_API_PORT), 10);
const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_API_PORT;

createApp().listen(port, () => {
  console.log(`API foundation listening on port ${port}`);
});
