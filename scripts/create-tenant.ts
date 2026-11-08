/**
 * Operator tool for pilot onboarding (there is no public signup):
 *   npm run tenant:create -- --name "Acme Builders" --admin-email owner@acme.com [--admin-name "Ann"] [--timezone America/Chicago]
 */
import { parseArgs } from "node:util";
import { getDb } from "@/db";
import { createTenantWithAdmin } from "@/domain/org";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      timezone: { type: "string" },
    },
  });
  if (!values.name || !values["admin-email"]) {
    console.error('Usage: npm run tenant:create -- --name "Acme Builders" --admin-email owner@acme.com');
    process.exit(1);
  }
  const db = await getDb();
  const { tenant, admin } = await createTenantWithAdmin(db, {
    name: values.name,
    adminEmail: values["admin-email"],
    adminName: values["admin-name"],
    timezone: values.timezone,
  });
  console.log(`Created tenant "${tenant.name}" (${tenant.id}) with admin ${admin.email}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
