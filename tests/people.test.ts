import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { outboundMessages } from "@/db/schema";
import { getProjectAccess } from "@/domain/access";
import { consumeLoginLink, requestLoginLink, safeReturnTo, userForSession } from "@/domain/auth";
import { findOrCreateUser } from "@/domain/org";
import { createInvite, decideAffiliation, describeInvite, pendingAffiliationsFor, redeemInvite } from "@/domain/people";
import { freshDb, hireWorker, seedTwoTenants } from "./helpers";

describe("invites and approval", () => {
  it("a redeemed invite creates a pending affiliation that grants no access until approved", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const { token } = await createInvite(db, s.adminA, { companyId: s.drain.id, role: "worker" });
    const maria = await findOrCreateUser(db, "maria@drain.test");
    const aff = await redeemInvite(db, maria.id, { token });
    expect(aff.status).toBe("pending");
    expect(await getProjectAccess(db, maria.id, s.projectA.id)).toBeNull();

    // Cannot approve yourself.
    await expect(decideAffiliation(db, maria.id, aff.id, "approved")).rejects.toThrow("Not authorized");
    // A manager of another tenant cannot approve.
    await expect(decideAffiliation(db, s.adminB, aff.id, "approved")).rejects.toThrow("Not authorized");

    await decideAffiliation(db, s.adminA, aff.id, "approved");
    expect(await getProjectAccess(db, maria.id, s.projectA.id)).toMatchObject({ kind: "worker" });
  });

  it("invites are single use and expire", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const { token } = await createInvite(db, s.adminA, { companyId: s.drain.id, role: "worker" });
    const u1 = await findOrCreateUser(db, "u1@x.test");
    const u2 = await findOrCreateUser(db, "u2@x.test");
    await redeemInvite(db, u1.id, { token });
    await expect(redeemInvite(db, u2.id, { token })).rejects.toThrow("invite_invalid");
    expect((await describeInvite(db, token))?.usable).toBe(false);
    expect(await describeInvite(db, "not-a-real-token")).toBeNull();
  });

  it("a supervisor can invite and approve workers of their own company only", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const sup = await hireWorker(db, s.adminA, s.plumbing.id, "sup@plumbing.test", "supervisor");
    // Supervisors cannot create supervisor invites.
    await expect(createInvite(db, sup.id, { companyId: s.plumbing.id, role: "supervisor" })).rejects.toThrow("Not authorized");
    // Nor invite into another company.
    await expect(createInvite(db, sup.id, { companyId: s.otherCo.id, role: "worker" })).rejects.toThrow("Not authorized");

    const { token } = await createInvite(db, sup.id, { companyId: s.plumbing.id, role: "worker" });
    const w = await findOrCreateUser(db, "w@plumbing.test");
    const aff = await redeemInvite(db, w.id, { token });
    const pending = await pendingAffiliationsFor(db, sup.id);
    expect(pending.map((p) => p.affiliation.id)).toEqual([aff.id]);
    await decideAffiliation(db, sup.id, aff.id, "approved");
    expect(await getProjectAccess(db, w.id, s.projectA.id)).toMatchObject({ kind: "worker", companyId: s.plumbing.id });
  });
});

describe("email-link login", () => {
  it("issues a single-use link and a session; redeems a pending invite on sign-in", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const { invite } = await createInvite(db, s.adminA, { companyId: s.plumbing.id, role: "worker" });
    await requestLoginLink(db, { email: "New.Person@Example.test", baseUrl: "http://localhost:3000", lang: "es", inviteId: invite.id, returnTo: "/q/abc" });
    const [msg] = await db.select().from(outboundMessages).where(eq(outboundMessages.recipient, "new.person@example.test"));
    expect(msg.subject).toBe("Su enlace para entrar a Project X");
    const token = decodeURIComponent(msg.body.match(/token=([^\s]+)/)![1]);

    const result = await consumeLoginLink(db, token);
    expect(result.returnTo).toBe("/q/abc");
    expect((await userForSession(db, result.sessionToken))?.email).toBe("new.person@example.test");
    await expect(consumeLoginLink(db, token)).rejects.toThrow("login_link_invalid");

    const pending = await pendingAffiliationsFor(db, s.adminA, s.a.tenant.id);
    expect(pending.some((p) => p.user.email === "new.person@example.test")).toBe(true);
  });

  it("only accepts same-site return paths", () => {
    expect(safeReturnTo("/q/abc")).toBe("/q/abc");
    expect(safeReturnTo("//evil.test")).toBeNull();
    expect(safeReturnTo("https://evil.test")).toBeNull();
    expect(safeReturnTo("/\\evil.test")).toBeNull();
  });
});
