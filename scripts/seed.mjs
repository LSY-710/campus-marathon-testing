import { fileURLToPath } from "node:url";
import { openDatabase } from "../apps/api/src/db.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const dbPath = process.env.DB_PATH ?? `${projectRoot}data/marathon.db`;
const db = openDatabase(dbPath);
const eventCount = Number(
  db.prepare("SELECT COUNT(*) AS count FROM events").get().count,
);
const userCount = Number(
  db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
);
db.close();

console.log(`Seed complete: ${dbPath}`);
console.log(`Users: ${userCount}`);
console.log(`Events: ${eventCount}`);
