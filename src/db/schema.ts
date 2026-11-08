import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const languageEnum = pgEnum("language", ["en", "es", "ht"]);
export const tenantRoleEnum = pgEnum("tenant_role", ["admin", "manager"]);
export const affiliationRoleEnum = pgEnum("affiliation_role", ["worker", "supervisor"]);
export const affiliationStatusEnum = pgEnum("affiliation_status", ["pending", "approved", "revoked"]);
export const entryMethodEnum = pgEnum("entry_method", ["qr"]);
export const locationStatusEnum = pgEnum("location_status", [
  "not_requested",
  "denied",
  "unavailable",
  "low_accuracy",
  "no_reference",
  "matched",
  "mismatch",
]);
export const channelEnum = pgEnum("message_channel", ["email", "push"]);

/** A subscribing general contractor account. */
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  createdAt: createdAt(),
});

/** One global login per person, shared across tenants. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(), // stored lowercased
  displayName: text("display_name").notNull().default(""),
  phone: text("phone"), // unverified contact detail, never used for auth
  preferredLanguage: languageEnum("preferred_language").notNull().default("en"),
  translationEnabled: boolean("translation_enabled").notNull().default(false),
  createdAt: createdAt(),
});

/** General-contractor staff of a tenant. Managers see all projects of the tenant. */
export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: tenantRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tenant_memberships_tenant_user").on(t.tenantId, t.userId)],
);

/** Company directory, scoped to one tenant. */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    isGeneralContractor: boolean("is_general_contractor").notNull().default(false),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("companies_tenant_name").on(t.tenantId, t.name)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("projects_tenant").on(t.tenantId)],
);

export const properties = pgTable(
  "properties",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    label: text("label").notNull(), // e.g. "House 12"
    address: text("address").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("properties_project").on(t.projectId)],
);

/** Project-scoped hiring relationship: hiring company hires hired company. */
export const subcontractEngagements = pgTable(
  "subcontract_engagements",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    hiringCompanyId: uuid("hiring_company_id").notNull().references(() => companies.id),
    hiredCompanyId: uuid("hired_company_id").notNull().references(() => companies.id),
    scope: text("scope").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("engagements_project").on(t.projectId)],
);

/** A person's employment link to a company. Pending affiliations grant nothing. */
export const workerAffiliations = pgTable(
  "worker_affiliations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    role: affiliationRoleEnum("role").notNull(),
    status: affiliationStatusEnum("status").notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("affiliations_one_active")
      .on(t.userId, t.companyId)
      .where(sql`${t.status} <> 'revoked'`),
  ],
);

/** Single-use, expiring onboarding invite. Only the hash of the token is stored. */
export const invites = pgTable("invites", {
  id: id(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  role: affiliationRoleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedBy: uuid("redeemed_by").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Manager-set contact visibility beyond the always-allowed paths. Project row overrides tenant row. */
export const contactPolicies = pgTable(
  "contact_policies",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    projectId: uuid("project_id").references(() => projects.id),
    workersCanContactManagers: boolean("workers_can_contact_managers").notNull().default(false),
    sidewaysContact: boolean("sideways_contact").notNull().default(false),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contact_policies_scope").on(t.tenantId, t.projectId).where(sql`${t.projectId} is not null`),
    uniqueIndex("contact_policies_tenant_default").on(t.tenantId).where(sql`${t.projectId} is null`)],
);

/** Opaque, revocable property link printed as a QR code. Identifies a property; never authorizes. */
export const qrTokens = pgTable("qr_tokens", {
  id: id(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  token: text("token").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const visits = pgTable(
  "visits",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    // Snapshots of employer and engagement at check-in time; never rewritten.
    companyId: uuid("company_id").notNull().references(() => companies.id),
    engagementId: uuid("engagement_id").notNull().references(() => subcontractEngagements.id),
    entryMethod: entryMethodEnum("entry_method").notNull(),
    qrTokenId: uuid("qr_token_id").references(() => qrTokens.id),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkInLocationStatus: locationStatusEnum("check_in_location_status").notNull(),
    checkInLatitude: doublePrecision("check_in_latitude"),
    checkInLongitude: doublePrecision("check_in_longitude"),
    checkInAccuracyM: doublePrecision("check_in_accuracy_m"),
    checkInLocationCapturedAt: timestamp("check_in_location_captured_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkOutLocationStatus: locationStatusEnum("check_out_location_status"),
    checkOutLatitude: doublePrecision("check_out_latitude"),
    checkOutLongitude: doublePrecision("check_out_longitude"),
    checkOutAccuracyM: doublePrecision("check_out_accuracy_m"),
  },
  (t) => [
    // A person can have at most one open visit anywhere. Enforced by the database under concurrency.
    uniqueIndex("visits_one_open_per_user").on(t.userId).where(sql`${t.checkedOutAt} is null`),
    index("visits_property").on(t.propertyId),
  ],
);

export const loginTokens = pgTable("login_tokens", {
  id: id(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  inviteId: uuid("invite_id").references(() => invites.id),
  returnTo: text("return_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Notification outbox. The dev provider leaves messages here for the local dev inbox. */
export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  channel: channelEnum("channel").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant").on(t.tenantId)],
);
