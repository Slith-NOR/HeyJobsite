import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { companies, invites, tenants, users, workerAffiliations } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { DomainError, NotAuthorized, isUniqueViolation } from "@/lib/errors";
import { approvedAffiliations, getMembership, requireCompanyAdmin } from "./access";
import { audit } from "./org";

export const INVITE_DAYS = 7;

/**
 * A manager or the company's approved supervisor creates a single-use invite link for a company.
 * Returns the raw token once; only its hash is stored.
 */
export async function createInvite(db: DB, actorId: string, input: { companyId: string; role: "worker" | "supervisor" }) {
  const company = await requireCompanyAdmin(db, actorId, input.companyId);
  if (company.isGeneralContractor) throw new DomainError("invite_gc_staff_as_members");
  // Only managers may create supervisors; supervisors invite workers.
  if (input.role === "supervisor" && !(await getMembership(db, actorId, company.tenantId))) throw new NotAuthorized();
  const token = randomToken();
  const [row] = await db
    .insert(invites)
    .values({
      tenantId: company.tenantId,
      companyId: company.id,
      role: input.role,
      tokenHash: sha256(token),
      createdBy: actorId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();
  await audit(db, { tenantId: company.tenantId, actorUserId: actorId, action: "invite.created", entityType: "invite", entityId: row.id, data: { role: input.role } });
  return { invite: row, token };
}

/** Public view of an invite: only what the invitee needs to decide. */
export async function describeInvite(db: DB, token: string) {
  const [row] = await db
    .select({ invite: invites, companyName: companies.name, tenantName: tenants.name })
    .from(invites)
    .innerJoin(companies, eq(companies.id, invites.companyId))
    .innerJoin(tenants, eq(tenants.id, invites.tenantId))
    .where(eq(invites.tokenHash, sha256(token)));
  if (!row) return null;
  const usable = !row.invite.redeemedAt && !row.invite.revokedAt && row.invite.expiresAt > new Date();
  return { id: row.invite.id, companyName: row.companyName, tenantName: row.tenantName, role: row.invite.role, usable };
}

/** Redeems an invite once, creating a pending affiliation that still needs approval. */
export async function redeemInvite(db: DB, userId: string, ref: { token?: string; inviteId?: string }) {
  return db.transaction(async (tx) => {
    const where = ref.token ? eq(invites.tokenHash, sha256(ref.token)) : eq(invites.id, ref.inviteId!);
    const [inv] = await tx
      .update(invites)
      .set({ redeemedAt: new Date(), redeemedBy: userId })
      .where(and(where, isNull(invites.redeemedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
      .returning();
    if (!inv) throw new DomainError("invite_invalid");
    const existing = await tx
      .select()
      .from(workerAffiliations)
      .where(and(eq(workerAffiliations.userId, userId), eq(workerAffiliations.companyId, inv.companyId), inArray(workerAffiliations.status, ["pending", "approved"])));
    if (existing.length) throw new DomainError("already_affiliated");
    try {
      const [aff] = await tx
        .insert(workerAffiliations)
        .values({ tenantId: inv.tenantId, userId, companyId: inv.companyId, role: inv.role, status: "pending", invitedBy: inv.createdBy })
        .returning();
      await audit(tx, { tenantId: inv.tenantId, actorUserId: userId, action: "invite.redeemed", entityType: "affiliation", entityId: aff.id });
      return aff;
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError("already_affiliated");
      throw e;
    }
  });
}

/** Approve or reject a pending affiliation. Nobody can decide their own. */
export async function decideAffiliation(db: DB, actorId: string, affiliationId: string, decision: "approved" | "revoked") {
  const [aff] = await db.select().from(workerAffiliations).where(eq(workerAffiliations.id, affiliationId));
  if (!aff) throw new DomainError("not_found");
  if (aff.userId === actorId) throw new NotAuthorized();
  await requireCompanyAdmin(db, actorId, aff.companyId);
  // Supervisors approve workers; only managers approve supervisors.
  if (aff.role === "supervisor" && !(await getMembership(db, actorId, aff.tenantId))) throw new NotAuthorized();
  if (decision === "approved" && aff.status !== "pending") throw new DomainError("not_pending");
  const [updated] = await db
    .update(workerAffiliations)
    .set({ status: decision, decidedBy: actorId, decidedAt: new Date() })
    .where(eq(workerAffiliations.id, aff.id))
    .returning();
  await audit(db, { tenantId: aff.tenantId, actorUserId: actorId, action: `affiliation.${decision}`, entityType: "affiliation", entityId: aff.id });
  return updated;
}

/** Pending affiliations the actor may decide: companies they supervise, or every company of a tenant they manage. */
export async function pendingAffiliationsFor(db: DB, actorId: string, tenantId?: string) {
  const supervised = (await approvedAffiliations(db, actorId)).filter((a) => a.role === "supervisor").map((a) => a.companyId);
  const rows = await db
    .select({ affiliation: workerAffiliations, user: users, companyName: companies.name })
    .from(workerAffiliations)
    .innerJoin(users, eq(users.id, workerAffiliations.userId))
    .innerJoin(companies, eq(companies.id, workerAffiliations.companyId))
    .where(and(eq(workerAffiliations.status, "pending"), tenantId ? eq(workerAffiliations.tenantId, tenantId) : undefined))
    .orderBy(desc(workerAffiliations.createdAt));
  const out = [];
  for (const r of rows) {
    if (r.affiliation.userId === actorId) continue;
    const isManager = !!(await getMembership(db, actorId, r.affiliation.tenantId));
    const isSupervisor = supervised.includes(r.affiliation.companyId) && r.affiliation.role === "worker";
    if (isManager || isSupervisor) out.push(r);
  }
  return out;
}

export async function myAffiliations(db: DB, userId: string) {
  return db
    .select({ affiliation: workerAffiliations, companyName: companies.name, tenantName: tenants.name })
    .from(workerAffiliations)
    .innerJoin(companies, eq(companies.id, workerAffiliations.companyId))
    .innerJoin(tenants, eq(tenants.id, workerAffiliations.tenantId))
    .where(and(eq(workerAffiliations.userId, userId), inArray(workerAffiliations.status, ["pending", "approved"])));
}
