import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { passkeys, users, webauthnChallenges } from "@/db/schema";
import { DomainError, isUniqueViolation } from "@/lib/errors";
import { createSession } from "./auth";
import { audit } from "./org";

/** Relying party: who the passkey belongs to. Derived from APP_BASE_URL in the app, injected in tests. */
export type RelyingParty = { name: string; id: string; origin: string };

/**
 * `rpId` may be the app host or a parent domain (e.g. heyjobsite.com for app.heyjobsite.com), so passkeys
 * keep working if the app moves between subdomains. Browsers reject anything else; we fail fast instead.
 */
export function relyingPartyFor(baseUrl: string, rpId?: string | null): RelyingParty {
  const url = new URL(baseUrl);
  const id = (rpId || url.hostname).toLowerCase();
  if (url.hostname !== id && !url.hostname.endsWith("." + id)) {
    throw new Error(`PASSKEY_RP_ID "${id}" must be ${url.hostname} or a parent domain of it`);
  }
  return { name: "HeyJobsite", id, origin: url.origin };
}

export const CHALLENGE_MINUTES = 5;

const b64url = {
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url"),
  decode: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

/** The WebAuthn user handle is the user's UUID as 16 bytes: opaque, stable, and contains no personal data. */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(userId.replace(/-/g, ""), "hex"));
}
function userIdFromHandle(handle: string): string | null {
  const hex = Buffer.from(handle, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function storeChallenge(db: DB, purpose: "register" | "login", challenge: string, userId: string | null) {
  const [row] = await db
    .insert(webauthnChallenges)
    .values({ purpose, challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000) })
    .returning({ id: webauthnChallenges.id });
  return row.id;
}

/** Uses up a challenge exactly once. A replayed, expired or mismatched challenge fails. */
async function consumeChallenge(db: DB, challengeId: string, purpose: "register" | "login", userId: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new DomainError("passkey_failed");
  const [row] = await db
    .update(webauthnChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.id, challengeId),
        eq(webauthnChallenges.purpose, purpose),
        userId ? eq(webauthnChallenges.userId, userId) : isNull(webauthnChallenges.userId),
        isNull(webauthnChallenges.usedAt),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new DomainError("passkey_failed");
  return row.challenge;
}

export async function listPasskeys(db: DB, actingUserId: string) {
  return db.select().from(passkeys).where(eq(passkeys.userId, actingUserId)).orderBy(desc(passkeys.createdAt));
}

/** Step 1 of adding a passkey for the signed-in person. */
export async function beginPasskeyRegistration(db: DB, actingUserId: string, rp: RelyingParty) {
  const [user] = await db.select().from(users).where(eq(users.id, actingUserId));
  if (!user) throw new DomainError("not_authorized");
  const existing = await listPasskeys(db, actingUserId);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    userID: userHandle(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports ?? undefined })),
    // Discoverable credential, so sign-in needs no email typed; face/fingerprint/PIN required.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await storeChallenge(db, "register", options.challenge, user.id);
  return { challengeId, options };
}

/** Step 2: verify the device's answer and store the public key. */
export async function finishPasskeyRegistration(
  db: DB,
  actingUserId: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
) {
  const expectedChallenge = await consumeChallenge(db, challengeId, "register", actingUserId);
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    throw new DomainError("passkey_failed");
  }
  if (!result.verified) throw new DomainError("passkey_failed");
  const info = result.registrationInfo;
  try {
    const [row] = await db
      .insert(passkeys)
      .values({
        userId: actingUserId,
        credentialId: info.credential.id,
        publicKey: b64url.encode(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? null,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
      })
      .returning();
    await audit(db, { tenantId: null, actorUserId: actingUserId, action: "passkey.added", entityType: "passkey", entityId: row.id });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("passkey_exists");
    throw e;
  }
}

/** Step 1 of signing in with a passkey. No email needed: the device offers its passkeys for this site. */
export async function beginPasskeyLogin(db: DB, rp: RelyingParty) {
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
  const challengeId = await storeChallenge(db, "login", options.challenge, null);
  return { challengeId, options };
}

/** Step 2: verify the signature against the stored public key and start a remembered session. */
export async function finishPasskeyLogin(db: DB, challengeId: string, response: AuthenticationResponseJSON, rp: RelyingParty) {
  const expectedChallenge = await consumeChallenge(db, challengeId, "login", null);
  const [pk] = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id));
  // Unknown credential: removed from the account, or registered elsewhere. The email link is the way back in.
  if (!pk) throw new DomainError("passkey_unknown");
  const claimed = response.response.userHandle ? userIdFromHandle(response.response.userHandle) : null;
  if (claimed && claimed !== pk.userId) throw new DomainError("passkey_failed");

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      credential: { id: pk.credentialId, publicKey: b64url.decode(pk.publicKey), counter: pk.counter, transports: pk.transports ?? undefined },
    });
  } catch {
    throw new DomainError("passkey_failed");
  }
  if (!result.verified) throw new DomainError("passkey_failed");

  await db
    .update(passkeys)
    .set({ counter: result.authenticationInfo.newCounter, backedUp: result.authenticationInfo.credentialBackedUp, lastUsedAt: new Date() })
    .where(eq(passkeys.id, pk.id));
  const [user] = await db.select().from(users).where(eq(users.id, pk.userId));
  const sessionToken = await createSession(db, user.id);
  return { sessionToken, user };
}

/** People can remove only their own passkeys. */
export async function removePasskey(db: DB, actingUserId: string, passkeyId: string) {
  const removed = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, actingUserId)))
    .returning({ id: passkeys.id, credentialId: passkeys.credentialId });
  if (removed.length === 0) throw new DomainError("not_authorized");
  await audit(db, { tenantId: null, actorUserId: actingUserId, action: "passkey.removed", entityType: "passkey", entityId: passkeyId });
  return removed[0];
}
