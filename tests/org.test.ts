import { describe, expect, it } from "vitest";
import { getProjectAccess } from "@/domain/access";
import { createCompany, createEngagement, createProperty, hiringChainNames, listProjects, listProperties } from "@/domain/org";
import { assertProductionSafe } from "@/lib/config";
import { freshDb, seedTwoTenants } from "./helpers";

describe("subcontract chain", () => {
  it("links a worker through two subcontracting levels", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const access = await getProjectAccess(db, s.john.id, s.projectA.id);
    expect(access).toMatchObject({ kind: "worker", companyId: s.drain.id });
    expect(await hiringChainNames(db, s.projectA.id, s.drain.id)).toEqual(["Alpha Builders", "Plumbing Co", "Drain Sub"]);
  });

  it("rejects cycles, self-hire, hiring the GC, and orphan hiring companies", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const base = { projectId: s.projectA.id, scope: "x" };
    await expect(createEngagement(db, s.adminA, { ...base, hiringCompanyId: s.drain.id, hiredCompanyId: s.plumbing.id })).rejects.toThrow("engagement_cycle");
    await expect(createEngagement(db, s.adminA, { ...base, hiringCompanyId: s.drain.id, hiredCompanyId: s.drain.id })).rejects.toThrow("engagement_cycle");
    await expect(createEngagement(db, s.adminA, { ...base, hiringCompanyId: s.plumbing.id, hiredCompanyId: s.a.generalContractor.id })).rejects.toThrow("general_contractor_cannot_be_hired");
    const loner = await createCompany(db, s.adminA, s.a.tenant.id, { name: "Loner LLC" });
    const other = await createCompany(db, s.adminA, s.a.tenant.id, { name: "Other LLC" });
    await expect(createEngagement(db, s.adminA, { ...base, hiringCompanyId: loner.id, hiredCompanyId: other.id })).rejects.toThrow("hiring_company_not_on_project");
  });

  it("allows the same company in different positions on different projects", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const { createProject } = await import("@/domain/org");
    const p2 = await createProject(db, s.adminA, s.a.tenant.id, { name: "Second" });
    // On project 2, Drain Sub is hired directly by the GC and hires Plumbing Co.
    await createEngagement(db, s.adminA, { projectId: p2.id, hiringCompanyId: s.a.generalContractor.id, hiredCompanyId: s.drain.id, scope: "Drains" });
    await createEngagement(db, s.adminA, { projectId: p2.id, hiringCompanyId: s.drain.id, hiredCompanyId: s.plumbing.id, scope: "Plumbing" });
    expect(await hiringChainNames(db, p2.id, s.plumbing.id)).toEqual(["Alpha Builders", "Drain Sub", "Plumbing Co"]);
  });
});

describe("tenant isolation", () => {
  it("a manager of tenant A cannot read or modify tenant B", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    await expect(listProjects(db, s.adminA, s.b.tenant.id)).rejects.toThrow("Not authorized");
    await expect(listProperties(db, s.adminA, s.projectB.id)).rejects.toThrow("Not authorized");
    await expect(createProperty(db, s.adminA, s.projectB.id, { label: "X", address: "Y" })).rejects.toThrow("Not authorized");
    await expect(createCompany(db, s.adminA, s.b.tenant.id, { name: "Sneaky" })).rejects.toThrow("Not authorized");
    await expect(
      createEngagement(db, s.adminB, { projectId: s.projectB.id, hiringCompanyId: s.b.generalContractor.id, hiredCompanyId: s.plumbing.id, scope: "x" }),
    ).rejects.toThrow("company_not_in_tenant");
  });

  it("a worker approved in tenant A has no access to tenant B projects", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    expect(await getProjectAccess(db, s.john.id, s.projectB.id)).toBeNull();
  });
});

describe("production configuration", () => {
  it("rejects fake email and the embedded database in production", () => {
    expect(() => assertProductionSafe({ NODE_ENV: "production", EMAIL_PROVIDER: "dev" } as NodeJS.ProcessEnv)).toThrow(/EMAIL_PROVIDER=dev/);
    expect(() => assertProductionSafe({ NODE_ENV: "production", EMAIL_PROVIDER: "resend", APP_BASE_URL: "https://x" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => assertProductionSafe({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
