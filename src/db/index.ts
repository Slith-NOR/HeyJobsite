import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";
import { assertProductionSafe } from "@/lib/config";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
export const LOCAL_DATA_DIR = path.join(process.cwd(), ".data", "pglite");

/** Creates an embedded PGlite database and applies migrations. Development and tests only. */
export async function createPgliteDb(dataDir?: string): Promise<DB> {
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as DB;
}

const globalForDb = globalThis as unknown as { __projectXDb?: Promise<DB> };

/** Application database. Uses DATABASE_URL (e.g. Supabase Postgres) when set, else local PGlite. */
export function getDb(): Promise<DB> {
  if (!globalForDb.__projectXDb) {
    assertProductionSafe();
    const url = process.env.DATABASE_URL;
    globalForDb.__projectXDb = url
      ? Promise.resolve(drizzlePostgres(postgres(url, { prepare: false }), { schema }) as unknown as DB)
      : createPgliteDb(LOCAL_DATA_DIR);
  }
  return globalForDb.__projectXDb;
}
