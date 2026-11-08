/**
 * Loads synthetic demo data into the local database: two unrelated contractor tenants.
 * All names, emails and addresses are fictional (.test domains). Refuses to run in production.
 */
import { getDb } from "@/db";
import { tenants } from "@/db/schema";
import { createCompany, createEngagement, createProject, createProperty, createTenantWithAdmin, findOrCreateUser } from "@/domain/org";
import { createInvite, decideAffiliation, redeemInvite } from "@/domain/people";
import { createQrToken } from "@/domain/visits";
import { updateProfile } from "@/domain/auth";
import { appBaseUrl, isProduction } from "@/lib/config";
import type { DB } from "@/db";

async function hire(db: DB, approverId: string, companyId: string, email: string, name: string, role: "worker" | "supervisor", lang: "en" | "es" | "ht" = "en") {
  const { token } = await createInvite(db, approverId, { companyId, role });
  const user = await findOrCreateUser(db, email, name);
  await updateProfile(db, user.id, { preferredLanguage: lang, phone: "+1 555 0100" });
  const aff = await redeemInvite(db, user.id, { token });
  await decideAffiliation(db, approverId, aff.id, "approved");
  return user;
}

async function main() {
  if (isProduction()) throw new Error("Refusing to seed demo data in production.");
  const db = await getDb();
  if ((await db.select().from(tenants)).length > 0) {
    console.log("Database already has data; skipping seed. Run `npm run db:reset` first for a clean demo.");
    return;
  }

  const a = await createTenantWithAdmin(db, { name: "Demo Alpha Builders", adminEmail: "admin@alpha.test", adminName: "Alice (Demo Admin)" });
  const admin = a.admin.id;
  const plumbing = await createCompany(db, admin, a.tenant.id, { name: "Demo Plumbing Co", phone: "+1 555 0101" });
  const drain = await createCompany(db, admin, a.tenant.id, { name: "Demo Drain Sub", phone: "+1 555 0102" });
  const project = await createProject(db, admin, a.tenant.id, { name: "Oak Ridge (demo)" });
  const h12 = await createProperty(db, admin, project.id, { label: "House 12", address: "12 Demo Oak St", latitude: 28.5383, longitude: -81.3792 });
  const h8 = await createProperty(db, admin, project.id, { label: "House 8", address: "8 Demo Oak St", latitude: 28.5389, longitude: -81.3795 });
  await createEngagement(db, admin, { projectId: project.id, hiringCompanyId: a.generalContractor.id, hiredCompanyId: plumbing.id, scope: "Plumbing" });
  await createEngagement(db, admin, { projectId: project.id, hiringCompanyId: plumbing.id, hiredCompanyId: drain.id, scope: "Drain lines" });
  await hire(db, admin, plumbing.id, "pat@plumbing.test", "Pat (Demo Supervisor)", "supervisor", "es");
  await hire(db, admin, drain.id, "john@drain.test", "John (Demo Worker)", "worker", "ht");
  const q12 = await createQrToken(db, admin, h12.id);
  await createQrToken(db, admin, h8.id);

  const b = await createTenantWithAdmin(db, { name: "Demo Bravo Homes", adminEmail: "admin@bravo.test", adminName: "Bob (Demo Admin)" });
  const framing = await createCompany(db, b.admin.id, b.tenant.id, { name: "Demo Bravo Framing" });
  const pb = await createProject(db, b.admin.id, b.tenant.id, { name: "Pine Hill (demo)" });
  const lot3 = await createProperty(db, b.admin.id, pb.id, { label: "Lot 3", address: "3 Demo Pine Rd" });
  await createEngagement(db, b.admin.id, { projectId: pb.id, hiringCompanyId: b.generalContractor.id, hiredCompanyId: framing.id, scope: "Framing" });
  await createQrToken(db, b.admin.id, lot3.id);

  console.log("Seeded synthetic demo data.");
  console.log("Sign in at /login with any of these (links appear in /dev/inbox):");
  console.log("  admin@alpha.test   Tenant A admin");
  console.log("  pat@plumbing.test  Supervisor, Demo Plumbing Co (Spanish)");
  console.log("  john@drain.test    Worker, Demo Drain Sub (Haitian Creole)");
  console.log("  admin@bravo.test   Tenant B admin");
  console.log(`House 12 check-in link: ${appBaseUrl()}/q/${q12.token}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
