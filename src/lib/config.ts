/** Central environment checks. Production must never run with fake providers or the embedded database. */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function emailProvider(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_PROVIDER || "dev";
}

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProduction(env) && emailProvider(env) === "dev";
}

export function assertProductionSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProduction(env)) return;
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required in production (embedded database is development-only)");
  if (emailProvider(env) === "dev") problems.push("EMAIL_PROVIDER=dev (fake login email) is not allowed in production");
  if (!env.APP_BASE_URL) problems.push("APP_BASE_URL is required in production");
  if (problems.length) throw new Error("Unsafe production configuration: " + problems.join("; "));
}
