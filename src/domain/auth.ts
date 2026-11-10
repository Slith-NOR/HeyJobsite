import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { loginTokens, sessions, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { DomainError } from "@/lib/errors";
import { sendEmail } from "@/lib/mailer";
import { t, type Lang } from "@/i18n";
import { findOrCreateUser, normalizeEmail } from "./org";
import { redeemInvite } from "./people";

export const LOGIN_TOKEN_MINUTES = 15;
/** A session ends after this many days without use; every use pushes the end date out again. */
export const SESSION_IDLE_DAYS = 60;
/** Browser cookie lifetime (browsers cap cookies at about 400 days). The database decides validity. */
export const SESSION_COOKIE_DAYS = 400;
const DAY_MS = 86_400_000;

/** Starts a remembered session. Returns the raw token; only its hash is stored. */
export async function createSession(db: DB, userId: string): Promise<string> {
  const sessionToken = randomToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_IDLE_DAYS * DAY_MS),
  });
  return sessionToken;
}

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
  const sessionToken = await createSession(db, user.id);
  return { sessionToken, user, returnTo: row.returnTo };
}

export async function userForSession(db: DB, sessionToken: string | undefined | null) {
  if (!sessionToken) return null;
  const [row] = await db
    .select({ user: users, sessionId: sessions.id, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(sessionToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  // Sliding expiry, written at most once a day per session.
  const renewed = new Date(Date.now() + SESSION_IDLE_DAYS * DAY_MS);
  if (renewed.getTime() - row.expiresAt.getTime() > DAY_MS) {
    await db.update(sessions).set({ expiresAt: renewed }).where(eq(sessions.id, row.sessionId));
  }
  return row.user;
}

/** Signs the person out everywhere except the device they are using now (e.g. after losing a phone). */
export async function revokeOtherSessions(db: DB, userId: string, currentSessionToken: string) {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.tokenHash, sha256(currentSessionToken))))
    .returning({ id: sessions.id });
  return revoked.length;
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
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage, languageChosenAt: new Date() } : {}),
      ...(input.translationEnabled !== undefined ? { translationEnabled: input.translationEnabled } : {}),
    })
    .where(eq(users.id, userId));
}

/** The person's own language choice (first sign-in chooser). */
export async function chooseLanguage(db: DB, userId: string, lang: Lang) {
  await db.update(users).set({ preferredLanguage: lang, languageChosenAt: new Date() }).where(eq(users.id, userId));
}

/** True until the person has picked a language themselves. */
export function needsLanguageChoice(user: { languageChosenAt: Date | null }): boolean {
  return user.languageChosenAt == null;
}
