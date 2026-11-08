/** Applies database migrations. Uses DATABASE_URL when set, else the local PGlite database. */
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { LOCAL_DATA_DIR, MIGRATIONS_FOLDER, createPgliteDb } from "@/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 1, prepare: false });
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    await client.end();
    console.log("Migrations applied to DATABASE_URL.");
  } else {
    await createPgliteDb(LOCAL_DATA_DIR);
    console.log(`Migrations applied to local PGlite at ${path.relative(process.cwd(), LOCAL_DATA_DIR)}.`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
