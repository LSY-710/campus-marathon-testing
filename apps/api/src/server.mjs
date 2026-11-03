import { fileURLToPath } from "node:url";
import { createApplication } from "./app.mjs";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const dbPath =
  process.env.DB_PATH ?? `${projectRoot}data/marathon.db`;
const authSecret =
  process.env.AUTH_SECRET ?? "development-only-change-me";

const application = createApplication({ dbPath, authSecret });

application.server.listen(port, "0.0.0.0", () => {
  console.log(`Marathon platform API: http://localhost:${port}/api`);
  console.log(`Admin console: http://localhost:${port}/admin/`);
  console.log(`Database: ${dbPath}`);
});

function shutdown() {
  application.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
