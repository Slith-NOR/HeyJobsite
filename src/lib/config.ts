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

/** Optional passkey domain, e.g. heyjobsite.com. Defaults to the APP_BASE_URL host. */
export function passkeyRpId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.PASSKEY_RP_ID || null;
}

export function postmarkServerToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.POSTMARK_SERVER_TOKEN || null;
}

export function emailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_FROM || "HeyJobsite <no-reply@mail.heyjobsite.com>";
}

export function emailReplyTo(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_REPLY_TO || "support@heyjobsite.com";
}

export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProduction(env) && emailProvider(env) === "dev";
}

export function assertProductionSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProduction(env)) return;
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required in production (embedded database is development-only)");
  const provider = emailProvider(env);
  if (provider === "dev") problems.push("EMAIL_PROVIDER=dev (fake login email) is not allowed in production");
  else if (provider !== "postmark") problems.push(`EMAIL_PROVIDER "${provider}" is not supported (use postmark)`);
  else if (!env.POSTMARK_SERVER_TOKEN) problems.push("POSTMARK_SERVER_TOKEN is required when EMAIL_PROVIDER=postmark");
  else if (env.POSTMARK_SERVER_TOKEN === "POSTMARK_API_TEST") problems.push("POSTMARK_SERVER_TOKEN is Postmark's test token, which sends nothing");
  if (!env.APP_BASE_URL) problems.push("APP_BASE_URL is required in production");
  if (problems.length) throw new Error("Unsafe production configuration: " + problems.join("; "));
}
