import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sessions } from "@/db/schema";
import { SESSION_IDLE_DAYS, createSession, revokeOtherSessions, userForSession } from "@/domain/auth";
import { findOrCreateUser } from "@/domain/org";
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
  relyingPartyFor,
  removePasskey,
} from "@/domain/passkeys";
import { sha256 } from "@/lib/crypto";
import { FakeAuthenticator } from "./fake-authenticator";
import { freshDb } from "./helpers";

const rp = relyingPartyFor("http://localhost:3000");
const device = () => new FakeAuthenticator(rp.id, rp.origin);

async function registered(db: Awaited<ReturnType<typeof freshDb>>, email = "john@drain.test") {
  const user = await findOrCreateUser(db, email);
  const phone = device();
  const reg = await beginPasskeyRegistration(db, user.id, rp);
  await finishPasskeyRegistration(db, user.id, reg.challengeId, phone.register(reg.options), rp);
  return { user, phone };
}

describe("passkeys", () => {
  it("registers a passkey and signs in with it, no email or password involved", async () => {
    const db = await freshDb();
    const { user, phone } = await registered(db);
    expect(await listPasskeys(db, user.id)).toHaveLength(1);

    const login = await beginPasskeyLogin(db, rp);
    const { sessionToken, user: signedIn } = await finishPasskeyLogin(db, login.challengeId, phone.authenticate(login.options), rp);
    expect(signedIn.id).toBe(user.id);
    expect((await userForSession(db, sessionToken))?.id).toBe(user.id);
    expect((await listPasskeys(db, user.id))[0].counter).toBe(1);
  });

  it("rejects a reused challenge", async () => {
    const db = await freshDb();
    const { phone } = await registered(db);
    const login = await beginPasskeyLogin(db, rp);
    const answer = phone.authenticate(login.options);
    await finishPasskeyLogin(db, login.challengeId, answer, rp);
    await expect(finishPasskeyLogin(db, login.challengeId, answer, rp)).rejects.toThrow("passkey_failed");
  });

  it("rejects an answer made for a look-alike website", async () => {
    const db = await freshDb();
    const { phone } = await registered(db);
    const login = await beginPasskeyLogin(db, rp);
    await expect(
      finishPasskeyLogin(db, login.challengeId, phone.authenticate(login.options, "https://projectx-login.example"), rp),
    ).rejects.toThrow("passkey_failed");
  });

  it("rejects a cloned passkey whose signature counter goes backwards", async () => {
    const db = await freshDb();
    const { phone } = await registered(db);
    for (let i = 0; i < 2; i++) {
      const login = await beginPasskeyLogin(db, rp);
      await finishPasskeyLogin(db, login.challengeId, phone.authenticate(login.options), rp);
    }
    phone.counter = 0; // a copy that has not seen the last two uses
    const login = await beginPasskeyLogin(db, rp);
    await expect(finishPasskeyLogin(db, login.challengeId, phone.authenticate(login.options), rp)).rejects.toThrow("passkey_failed");
  });

  it("a registration challenge belongs to the person who started it", async () => {
    const db = await freshDb();
    const alice = await findOrCreateUser(db, "alice@example.test");
    const mallory = await findOrCreateUser(db, "mallory@example.test");
    const reg = await beginPasskeyRegistration(db, alice.id, rp);
    await expect(finishPasskeyRegistration(db, mallory.id, reg.challengeId, device().register(reg.options), rp)).rejects.toThrow("passkey_failed");
    // A sign-in challenge cannot be used to register either.
    const login = await beginPasskeyLogin(db, rp);
    await expect(finishPasskeyRegistration(db, alice.id, login.challengeId, device().register({ ...login.options, user: { id: "x" } }), rp)).rejects.toThrow(
      "passkey_failed",
    );
  });

  it("a removed passkey no longer signs in; people can remove only their own", async () => {
    const db = await freshDb();
    const { user, phone } = await registered(db);
    const other = await findOrCreateUser(db, "other@example.test");
    const [pk] = await listPasskeys(db, user.id);
    await expect(removePasskey(db, other.id, pk.id)).rejects.toThrow("not_authorized");
    await removePasskey(db, user.id, pk.id);
    const login = await beginPasskeyLogin(db, rp);
    await expect(finishPasskeyLogin(db, login.challengeId, phone.authenticate(login.options), rp)).rejects.toThrow("passkey_unknown");
  });
});

describe("passkey domain", () => {
  it("accepts the app host or a parent domain, nothing else", () => {
    expect(relyingPartyFor("https://app.heyjobsite.com", "heyjobsite.com")).toEqual({
      name: "HeyJobsite",
      id: "heyjobsite.com",
      origin: "https://app.heyjobsite.com",
    });
    expect(relyingPartyFor("https://app.heyjobsite.com").id).toBe("app.heyjobsite.com");
    expect(() => relyingPartyFor("https://app.heyjobsite.com", "jobsite.com")).toThrow();
    expect(() => relyingPartyFor("https://app.heyjobsite.com", "other.example")).toThrow();
  });
});

describe("remembered sessions", () => {
  it("extend while in use and expire after the idle limit", async () => {
    const db = await freshDb();
    const user = await findOrCreateUser(db, "john@drain.test");
    const token = await createSession(db, user.id);
    // Pretend the session was last extended 10 days ago.
    const tenDaysAgo = new Date(Date.now() + (SESSION_IDLE_DAYS - 10) * 86_400_000);
    await db.update(sessions).set({ expiresAt: tenDaysAgo }).where(eq(sessions.tokenHash, sha256(token)));
    expect(await userForSession(db, token)).not.toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token)));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_IDLE_DAYS - 1) * 86_400_000);

    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, sha256(token)));
    expect(await userForSession(db, token)).toBeNull();
  });

  it("signing out other devices keeps the current one", async () => {
    const db = await freshDb();
    const user = await findOrCreateUser(db, "john@drain.test");
    const lostPhone = await createSession(db, user.id);
    const newPhone = await createSession(db, user.id);
    expect(await revokeOtherSessions(db, user.id, newPhone)).toBe(1);
    expect(await userForSession(db, lostPhone)).toBeNull();
    expect((await userForSession(db, newPhone))?.id).toBe(user.id);
  });
});
