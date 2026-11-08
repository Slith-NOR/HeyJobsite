import { and, eq, inArray, isNull, lte, or, gte } from "drizzle-orm";
import type { DB } from "@/db";
import {
  companies,
  projects,
  subcontractEngagements,
  tenantMemberships,
  workerAffiliations,
} from "@/db/schema";
import { NotAuthorized } from "@/lib/errors";

/**
 * Authorization helpers. Every check derives tenant scope from the stored record,
 * never from a client-supplied tenant ID.
 */

export async function getMembership(db: DB, userId: string, tenantId: string) {
  const [m] = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)));
  return m ?? null;
}

/** General-contractor admin or manager of the tenant. */
export async function requireTenantManager(db: DB, userId: string, tenantId: string) {
  const m = await getMembership(db, userId, tenantId);
  if (!m) throw new NotAuthorized();
  return m;
}

export async function requireTenantAdmin(db: DB, userId: string, tenantId: string) {
  const m = await getMembership(db, userId, tenantId);
  if (!m || m.role !== "admin") throw new NotAuthorized();
  return m;
}

export async function approvedAffiliations(db: DB, userId: string, tenantId?: string) {
  return db
    .select()
    .from(workerAffiliations)
    .where(
      and(
        eq(workerAffiliations.userId, userId),
        eq(workerAffiliations.status, "approved"),
        tenantId ? eq(workerAffiliations.tenantId, tenantId) : undefined,
      ),
    );
}

/** Approved supervisor of the company, or manager of the company's tenant. */
export async function requireCompanyAdmin(db: DB, userId: string, companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new NotAuthorized();
  if (await getMembership(db, userId, company.tenantId)) return company;
  const [sup] = await db
    .select()
    .from(workerAffiliations)
    .where(
      and(
        eq(workerAffiliations.userId, userId),
        eq(workerAffiliations.companyId, companyId),
        eq(workerAffiliations.status, "approved"),
        eq(workerAffiliations.role, "supervisor"),
      ),
    );
  if (!sup) throw new NotAuthorized();
  return company;
}

/** Engagements on a project that are active on the given date (YYYY-MM-DD). */
export function activeEngagementFilter(projectId: string, today: string) {
  return and(
    eq(subcontractEngagements.projectId, projectId),
    or(isNull(subcontractEngagements.startsOn), lte(subcontractEngagements.startsOn, today)),
    or(isNull(subcontractEngagements.endsOn), gte(subcontractEngagements.endsOn, today)),
  );
}

export function todayIn(timezone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type ProjectAccess =
  | { kind: "manager"; tenantId: string }
  | { kind: "worker"; tenantId: string; companyId: string; engagementId: string; role: "worker" | "supervisor" };

/**
 * Resolves how a user may act on a project: as a tenant manager, or as an approved
 * worker/supervisor of a company actively hired on that project.
 */
export async function getProjectAccess(db: DB, userId: string, projectId: string, now = new Date()): Promise<ProjectAccess | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.archivedAt) return null;
  if (await getMembership(db, userId, project.tenantId)) return { kind: "manager", tenantId: project.tenantId };

  const affs = await approvedAffiliations(db, userId, project.tenantId);
  if (!affs.length) return null;
  const engagements = await db
    .select()
    .from(subcontractEngagements)
    .where(
      and(
        activeEngagementFilter(projectId, todayIn(project.timezone, now)),
        inArray(
          subcontractEngagements.hiredCompanyId,
          affs.map((a) => a.companyId),
        ),
      ),
    )
    .orderBy(subcontractEngagements.createdAt);
  // A person affiliated with several engaged companies uses the earliest engagement.
  // TODO(phase 2 follow-up): let the worker choose which employer they are checking in for.
  const e = engagements[0];
  if (!e) return null;
  const aff = affs.find((a) => a.companyId === e.hiredCompanyId)!;
  return { kind: "worker", tenantId: project.tenantId, companyId: e.hiredCompanyId, engagementId: e.id, role: aff.role };
}
