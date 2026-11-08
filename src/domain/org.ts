import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditEvents,
  companies,
  projects,
  properties,
  subcontractEngagements,
  tenantMemberships,
  tenants,
  users,
} from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { requireTenantAdmin, requireTenantManager } from "./access";

export async function audit(
  db: DB,
  e: { tenantId: string | null; actorUserId: string | null; action: string; entityType: string; entityId?: string | null; data?: unknown },
) {
  await db.insert(auditEvents).values({
    tenantId: e.tenantId,
    actorUserId: e.actorUserId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    data: e.data ?? null,
  });
}

export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new DomainError("invalid_email");
  return e;
}

export async function findOrCreateUser(db: DB, email: string, displayName = "") {
  const normalized = normalizeEmail(email);
  await db.insert(users).values({ email: normalized, displayName }).onConflictDoNothing({ target: users.email });
  const [u] = await db.select().from(users).where(eq(users.email, normalized));
  return u;
}

/**
 * Operator-only: creates a pilot tenant, its general-contractor company and first admin.
 * There is no public signup; this is called from scripts/create-tenant.ts.
 */
export async function createTenantWithAdmin(
  db: DB,
  input: { name: string; adminEmail: string; adminName?: string; timezone?: string },
) {
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: input.name, timezone: input.timezone ?? "America/New_York" })
      .returning();
    const admin = await findOrCreateUser(tx, input.adminEmail, input.adminName ?? "");
    await tx.insert(tenantMemberships).values({ tenantId: tenant.id, userId: admin.id, role: "admin" });
    const [gc] = await tx
      .insert(companies)
      .values({ tenantId: tenant.id, name: input.name, isGeneralContractor: true })
      .returning();
    await audit(tx, { tenantId: tenant.id, actorUserId: null, action: "tenant.created", entityType: "tenant", entityId: tenant.id });
    return { tenant, admin, generalContractor: gc };
  });
}

/** Tenants where the user is general-contractor staff. */
export async function myTenants(db: DB, userId: string) {
  return db
    .select({ tenant: tenants, role: tenantMemberships.role })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(eq(tenantMemberships.userId, userId))
    .orderBy(asc(tenants.name));
}

export async function getTenantForManager(db: DB, userId: string, tenantId: string) {
  await requireTenantManager(db, userId, tenantId);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return tenant;
}

export async function addTenantMember(db: DB, actorId: string, tenantId: string, email: string, role: "admin" | "manager") {
  await requireTenantAdmin(db, actorId, tenantId);
  const user = await findOrCreateUser(db, email);
  await db.insert(tenantMemberships).values({ tenantId, userId: user.id, role }).onConflictDoNothing();
  await audit(db, { tenantId, actorUserId: actorId, action: "member.added", entityType: "user", entityId: user.id, data: { role } });
  return user;
}

export async function createCompany(db: DB, actorId: string, tenantId: string, input: { name: string; phone?: string | null }) {
  await requireTenantManager(db, actorId, tenantId);
  const name = input.name.trim();
  if (!name) throw new DomainError("name_required");
  const [c] = await db
    .insert(companies)
    .values({ tenantId, name, phone: input.phone?.trim() || null })
    .returning();
  await audit(db, { tenantId, actorUserId: actorId, action: "company.created", entityType: "company", entityId: c.id });
  return c;
}

export async function listCompanies(db: DB, actorId: string, tenantId: string) {
  await requireTenantManager(db, actorId, tenantId);
  return db.select().from(companies).where(eq(companies.tenantId, tenantId)).orderBy(asc(companies.name));
}

export async function createProject(db: DB, actorId: string, tenantId: string, input: { name: string; timezone?: string }) {
  await requireTenantManager(db, actorId, tenantId);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const name = input.name.trim();
  if (!name) throw new DomainError("name_required");
  const [p] = await db
    .insert(projects)
    .values({ tenantId, name, timezone: input.timezone || tenant.timezone })
    .returning();
  await audit(db, { tenantId, actorUserId: actorId, action: "project.created", entityType: "project", entityId: p.id });
  return p;
}

export async function listProjects(db: DB, actorId: string, tenantId: string) {
  await requireTenantManager(db, actorId, tenantId);
  return db.select().from(projects).where(eq(projects.tenantId, tenantId)).orderBy(asc(projects.name));
}

export async function getProjectForManager(db: DB, actorId: string, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new DomainError("not_found");
  await requireTenantManager(db, actorId, p.tenantId);
  return p;
}

export async function createProperty(
  db: DB,
  actorId: string,
  projectId: string,
  input: { label: string; address: string; latitude?: number | null; longitude?: number | null },
) {
  const project = await getProjectForManager(db, actorId, projectId);
  if (!input.label.trim() || !input.address.trim()) throw new DomainError("label_and_address_required");
  const [prop] = await db
    .insert(properties)
    .values({
      tenantId: project.tenantId,
      projectId,
      label: input.label.trim(),
      address: input.address.trim(),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    })
    .returning();
  await audit(db, { tenantId: project.tenantId, actorUserId: actorId, action: "property.created", entityType: "property", entityId: prop.id });
  return prop;
}

export async function listProperties(db: DB, actorId: string, projectId: string) {
  await getProjectForManager(db, actorId, projectId);
  return db.select().from(properties).where(eq(properties.projectId, projectId)).orderBy(asc(properties.label));
}

type EngagementRow = typeof subcontractEngagements.$inferSelect;

/** Companies that hired `companyId` on the project, walking up the chain (nearest first). */
export function ancestorsOf(engagements: EngagementRow[], companyId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [companyId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of engagements) {
      if (e.hiredCompanyId === current && !seen.has(e.hiringCompanyId)) {
        seen.add(e.hiringCompanyId);
        queue.push(e.hiringCompanyId);
      }
    }
  }
  return seen;
}

/** Companies hired directly or indirectly by `companyId` on the project. */
export function descendantsOf(engagements: EngagementRow[], companyId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [companyId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of engagements) {
      if (e.hiringCompanyId === current && !seen.has(e.hiredCompanyId)) {
        seen.add(e.hiredCompanyId);
        queue.push(e.hiredCompanyId);
      }
    }
  }
  return seen;
}

/**
 * Records that `hiringCompanyId` hired `hiredCompanyId` on a project.
 * Rules: both companies belong to the project's tenant; the hiring company is the general
 * contractor or already engaged on the project; the general contractor is never hired;
 * and the new link must not create a cycle.
 */
export async function createEngagement(
  db: DB,
  actorId: string,
  input: { projectId: string; hiringCompanyId: string; hiredCompanyId: string; scope: string; startsOn?: string | null; endsOn?: string | null },
) {
  const project = await getProjectForManager(db, actorId, input.projectId);
  return db.transaction(async (tx) => {
    // Serialize chain changes per project so concurrent edits cannot form a cycle.
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");

    const cs = await tx.select().from(companies).where(eq(companies.tenantId, project.tenantId));
    const hiring = cs.find((c) => c.id === input.hiringCompanyId);
    const hired = cs.find((c) => c.id === input.hiredCompanyId);
    if (!hiring || !hired) throw new DomainError("company_not_in_tenant");
    if (hired.isGeneralContractor) throw new DomainError("general_contractor_cannot_be_hired");
    if (hiring.id === hired.id) throw new DomainError("engagement_cycle");
    if (!input.scope.trim()) throw new DomainError("scope_required");
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new DomainError("invalid_dates");

    const existing = await tx.select().from(subcontractEngagements).where(eq(subcontractEngagements.projectId, project.id));
    if (!hiring.isGeneralContractor && !existing.some((e) => e.hiredCompanyId === hiring.id)) {
      throw new DomainError("hiring_company_not_on_project");
    }
    if (ancestorsOf(existing, hiring.id).has(hired.id)) throw new DomainError("engagement_cycle");

    const [row] = await tx
      .insert(subcontractEngagements)
      .values({
        tenantId: project.tenantId,
        projectId: project.id,
        hiringCompanyId: hiring.id,
        hiredCompanyId: hired.id,
        scope: input.scope.trim(),
        startsOn: input.startsOn || null,
        endsOn: input.endsOn || null,
        createdBy: actorId,
      })
      .returning();
    await audit(tx, { tenantId: project.tenantId, actorUserId: actorId, action: "engagement.created", entityType: "engagement", entityId: row.id });
    return row;
  });
}

export async function projectEngagements(db: DB, projectId: string) {
  return db
    .select()
    .from(subcontractEngagements)
    .where(eq(subcontractEngagements.projectId, projectId))
    .orderBy(asc(subcontractEngagements.createdAt));
}

/** Hiring chain names from the general contractor down to `companyId`, e.g. ["GC", "Plumbing Co", "Drain Sub"]. */
export async function hiringChainNames(db: DB, projectId: string, companyId: string): Promise<string[]> {
  const engagements = await projectEngagements(db, projectId);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const cs = await db.select().from(companies).where(eq(companies.tenantId, project.tenantId));
  const name = (id: string) => cs.find((c) => c.id === id)?.name ?? "?";
  const chain = [companyId];
  let current = companyId;
  for (let i = 0; i < 20; i++) {
    const up = engagements.find((e) => e.hiredCompanyId === current);
    if (!up) break;
    chain.unshift(up.hiringCompanyId);
    current = up.hiringCompanyId;
  }
  return chain.map(name);
}

export async function engagementsWithNames(db: DB, actorId: string, projectId: string) {
  const project = await getProjectForManager(db, actorId, projectId);
  const rows = await projectEngagements(db, projectId);
  const cs = await db.select().from(companies).where(and(eq(companies.tenantId, project.tenantId)));
  const name = (id: string) => cs.find((c) => c.id === id)?.name ?? "?";
  return rows.map((r) => ({ ...r, hiringName: name(r.hiringCompanyId), hiredName: name(r.hiredCompanyId) }));
}
