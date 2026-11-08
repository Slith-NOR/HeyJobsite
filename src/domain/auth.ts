import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { loginTokens, sessions, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { DomainError } from "@/lib/errors";
import { sendEmail } from "@/lib/mailer";
import { t, type Lang } from "@/i18n";
import { findOrCreateUser, normalizeEmail } from "./org";
import { redeemInvite } from "./people";

export const LOGIN_TOKEN_MINUTES = 15;
export const SESSION_DAYS = 30;

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

/** Emails a single-use sign-in link. The response never reveals whether the address has an account. */
export async function requestLoginLink(
  db: DB,
  input: { email: string; baseUrl: string; lang: Lang; inviteId?: string | null; returnTo?: string | null },
) {
  const email = normalizeEmail(input.email);
  const token = randomToken();
  await db.insert(loginTokens).values({
    email,
    tokenHash: sha256(token),
    inviteId: input.inviteId ?? null,
    returnTo: safeReturnTo(input.returnTo),
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000),
  });
  const link = `${input.baseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(db, {
    to: email,
    subject: t(input.lang, "email.login.subject"),
    body: `${t(input.lang, "email.login.body")}\n\n${link}\n\n${t(input.lang, "email.login.expires")}`,
  });
}

/**
 * Consumes a sign-in link exactly once and starts a session. Returns the raw session token
 * (stored only as a hash) and where to go next.
 */
export async function consumeLoginLink(db: DB, token: string) {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning();
  if (!row) throw new DomainError("login_link_invalid");
  const user = await findOrCreateUser(db, row.email);
  if (row.inviteId) {
    try {
      await redeemInvite(db, user.id, { inviteId: row.inviteId });
    } catch (e) {
      // An expired or used invite must not block sign-in; the home page shows affiliation status.
      if (!(e instanceof DomainError)) throw e;
    }
  }
  const sessionToken = randomToken();
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: sha256(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  return { sessionToken, user, returnTo: row.returnTo };
}

export async function userForSession(db: DB, sessionToken: string | undefined | null) {
  if (!sessionToken) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(sessionToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function revokeSession(db: DB, sessionToken: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(sessionToken)));
}

export async function updateProfile(
  db: DB,
  userId: string,
  input: { displayName?: string; phone?: string | null; preferredLanguage?: Lang; translationEnabled?: boolean },
) {
  await db
    .update(users)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim().slice(0, 100) } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      ...(input.translationEnabled !== undefined ? { translationEnabled: input.translationEnabled } : {}),
    })
    .where(eq(users.id, userId));
}
