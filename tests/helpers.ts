import { createPgliteDb, type DB } from "@/db";
import { createCompany, createEngagement, createProject, createProperty, createTenantWithAdmin, findOrCreateUser } from "@/domain/org";
import { createInvite, decideAffiliation, redeemInvite } from "@/domain/people";
import { createQrToken } from "@/domain/visits";

/** Fresh in-memory database with migrations applied. */
export function freshDb(): Promise<DB> {
  return createPgliteDb();
}

/** Adds a user to a company through the real invite → redeem → approve flow. */
export async function hireWorker(db: DB, approverId: string, companyId: string, email: string, role: "worker" | "supervisor" = "worker") {
  const { token } = await createInvite(db, approverId, { companyId, role });
  const user = await findOrCreateUser(db, email, email.split("@")[0]);
  const aff = await redeemInvite(db, user.id, { token });
  await decideAffiliation(db, approverId, aff.id, "approved");
  return user;
}

/**
 * Tenant A: GC hires Plumbing Co, which hires Drain Sub, on project "Oak Ridge" with House 12 and House 8.
 * Tenant B: an unrelated contractor with its own project and house.
 */
export async function seedTwoTenants(db: DB) {
  const a = await createTenantWithAdmin(db, { name: "Alpha Builders", adminEmail: "admin@alpha.test", adminName: "Alice Admin" });
  const b = await createTenantWithAdmin(db, { name: "Bravo Homes", adminEmail: "admin@bravo.test", adminName: "Bob Admin" });
  const adminA = a.admin.id;
  const adminB = b.admin.id;

  const plumbing = await createCompany(db, adminA, a.tenant.id, { name: "Plumbing Co" });
  const drain = await createCompany(db, adminA, a.tenant.id, { name: "Drain Sub" });
  const projectA = await createProject(db, adminA, a.tenant.id, { name: "Oak Ridge" });
  const house12 = await createProperty(db, adminA, projectA.id, { label: "House 12", address: "12 Oak St", latitude: 40.0, longitude: -75.0 });
  const house8 = await createProperty(db, adminA, projectA.id, { label: "House 8", address: "8 Oak St" });
  await createEngagement(db, adminA, { projectId: projectA.id, hiringCompanyId: a.generalContractor.id, hiredCompanyId: plumbing.id, scope: "Plumbing" });
  await createEngagement(db, adminA, { projectId: projectA.id, hiringCompanyId: plumbing.id, hiredCompanyId: drain.id, scope: "Drains" });

  const john = await hireWorker(db, adminA, drain.id, "john@drain.test");
  const qr12 = await createQrToken(db, adminA, house12.id);
  const qr8 = await createQrToken(db, adminA, house8.id);

  const otherCo = await createCompany(db, adminB, b.tenant.id, { name: "Bravo Framing" });
  const projectB = await createProject(db, adminB, b.tenant.id, { name: "Pine Hill" });
  const houseB = await createProperty(db, adminB, projectB.id, { label: "Lot 3", address: "3 Pine Rd" });
  await createEngagement(db, adminB, { projectId: projectB.id, hiringCompanyId: b.generalContractor.id, hiredCompanyId: otherCo.id, scope: "Framing" });
  const qrB = await createQrToken(db, adminB, houseB.id);

  return { a, b, adminA, adminB, plumbing, drain, projectA, house12, house8, john, qr12, qr8, otherCo, projectB, houseB, qrB };
}
