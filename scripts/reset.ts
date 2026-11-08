/** Deletes the local PGlite database. Never touches DATABASE_URL databases. */
import fs from "node:fs";
import { LOCAL_DATA_DIR } from "@/db";

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set; reset only works on the local embedded database.");
  process.exit(1);
}
fs.rmSync(LOCAL_DATA_DIR, { recursive: true, force: true });
console.log("Local database removed. Run `npm run db:migrate` and `npm run db:seed`.");
