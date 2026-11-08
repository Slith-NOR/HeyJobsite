import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { companies, projects, properties, qrTokens, users, visits } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { DomainError, NotAuthorized, isUniqueViolation } from "@/lib/errors";
import { getProjectAccess, requireTenantManager } from "./access";
import { audit, hiringChainNames } from "./org";

/** Open visits older than this are shown as stale (likely a forgotten check-out). */
export const STALE_VISIT_HOURS = 12;
/** Readings less precise than this are recorded as low accuracy, never as a match. */
export const MAX_USEFUL_ACCURACY_M = 100;
/** Minimum match radius around the property's reference point. */
export const MATCH_RADIUS_M = 75;

export type LocationReading =
  | { permission: "denied" }
  | { permission: "unavailable" }
  | { permission: "not_requested" }
  | { permission: "granted"; latitude: number; longitude: number; accuracyM: number; capturedAt: Date };

export type LocationStatus = "not_requested" | "denied" | "unavailable" | "low_accuracy" | "no_reference" | "matched" | "mismatch";

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Classifies a location reading against a property. A denied or missing reading is never
 * reported as verified, and GPS is never trusted to tell adjacent houses apart: a "matched"
 * status only means the reading is consistent with the QR-selected property.
 */
export function classifyLocation(reading: LocationReading, property: { latitude: number | null; longitude: number | null }): LocationStatus {
  if (reading.permission !== "granted") return reading.permission;
  if (!Number.isFinite(reading.accuracyM) || reading.accuracyM > MAX_USEFUL_ACCURACY_M) return "low_accuracy";
  if (property.latitude == null || property.longitude == null) return "no_reference";
  const d = distanceMeters(reading.latitude, reading.longitude, property.latitude, property.longitude);
  return d <= Math.max(MATCH_RADIUS_M, reading.accuracyM) ? "matched" : "mismatch";
}

function locationColumns(reading: LocationReading, prefix: "checkIn" | "checkOut") {
  if (reading.permission !== "granted") return {};
  return prefix === "checkIn"
    ? { checkInLatitude: reading.latitude, checkInLongitude: reading.longitude, checkInAccuracyM: reading.accuracyM, checkInLocationCapturedAt: reading.capturedAt }
    : { checkOutLatitude: reading.latitude, checkOutLongitude: reading.longitude, checkOutAccuracyM: reading.accuracyM };
}

// ---------- QR codes ----------

/** Creates a new printable QR link for a property. Older links stay valid until revoked. */
export async function createQrToken(db: DB, actorId: string, propertyId: string) {
  const [prop] = await db.select().from(properties).where(eq(properties.id, propertyId));
  if (!prop) throw new DomainError("not_found");
  await requireTenantManager(db, actorId, prop.tenantId);
  const [row] = await db
    .insert(qrTokens)
    .values({ tenantId: prop.tenantId, propertyId: prop.id, token: randomToken(18), createdBy: actorId })
    .returning();
  await audit(db, { tenantId: prop.tenantId, actorUserId: actorId, action: "qr.created", entityType: "qr_token", entityId: row.id });
  return row;
}

export async function revokeQrToken(db: DB, actorId: string, qrTokenId: string) {
  const [row] = await db.select().from(qrTokens).where(eq(qrTokens.id, qrTokenId));
  if (!row) throw new DomainError("not_found");
  await requireTenantManager(db, actorId, row.tenantId);
  await db.update(qrTokens).set({ revokedAt: new Date() }).where(and(eq(qrTokens.id, row.id), isNull(qrTokens.revokedAt)));
  await audit(db, { tenantId: row.tenantId, actorUserId: actorId, action: "qr.revoked", entityType: "qr_token", entityId: row.id });
}

export async function activeQrTokensForProperty(db: DB, actorId: string, propertyId: string) {
  const [prop] = await db.select().from(properties).where(eq(properties.id, propertyId));
  if (!prop) throw new DomainError("not_found");
  await requireTenantManager(db, actorId, prop.tenantId);
  const tokens = await db
    .select()
    .from(qrTokens)
    .where(and(eq(qrTokens.propertyId, propertyId), isNull(qrTokens.revokedAt)))
    .orderBy(desc(qrTokens.createdAt));
  return { property: prop, tokens };
}

/** Resolves a scanned QR token to its property. Returns null for unknown, revoked or archived. */
export async function resolveQrToken(db: DB, token: string) {
  const [row] = await db
    .select({ qr: qrTokens, property: properties, project: projects })
    .from(qrTokens)
    .innerJoin(properties, eq(properties.id, qrTokens.propertyId))
    .innerJoin(projects, eq(projects.id, properties.projectId))
    .where(eq(qrTokens.token, token));
  if (!row || row.qr.revokedAt || row.property.archivedAt || row.project.archivedAt) return null;
  return row;
}

// ---------- Check-in / check-out ----------

export async function openVisitFor(db: DB, userId: string) {
  const [row] = await db
    .select({ visit: visits, property: properties })
    .from(visits)
    .innerJoin(properties, eq(properties.id, visits.propertyId))
    .where(and(eq(visits.userId, userId), isNull(visits.checkedOutAt)));
  return row ?? null;
}

/**
 * What the confirmation page shows for a scanned QR code. The token only identifies the
 * property; access comes from the signed-in user's approved affiliation or tenant role.
 */
export async function checkInContext(db: DB, userId: string, token: string) {
  const resolved = await resolveQrToken(db, token);
  if (!resolved) return { state: "unavailable" as const };
  const access = await getProjectAccess(db, userId, resolved.property.projectId);
  if (!access || access.kind !== "worker") return { state: "not_authorized" as const };
  const open = await openVisitFor(db, userId);
  const [company] = await db.select().from(companies).where(eq(companies.id, access.companyId));
  return {
    state: open ? (open.visit.propertyId === resolved.property.id ? ("checked_in_here" as const) : ("checked_in_elsewhere" as const)) : ("ready" as const),
    property: resolved.property,
    timezone: resolved.project.timezone,
    companyName: company.name,
    openVisit: open,
  };
}

/**
 * Checks a worker in at the property identified by a QR token, with a server timestamp.
 * Idempotent: repeating the scan while checked in here returns the same open visit.
 * An open visit at a different property must be resolved first; it is never silently moved.
 */
export async function checkIn(db: DB, userId: string, input: { token: string; location: LocationReading }) {
  const resolved = await resolveQrToken(db, input.token);
  if (!resolved) throw new DomainError("qr_unavailable");
  const access = await getProjectAccess(db, userId, resolved.property.projectId);
  if (!access || access.kind !== "worker") throw new NotAuthorized();

  const existing = await openVisitFor(db, userId);
  if (existing) {
    if (existing.visit.propertyId === resolved.property.id) return { visit: existing.visit, created: false };
    throw new DomainError("open_visit_elsewhere");
  }
  try {
    const [visit] = await db
      .insert(visits)
      .values({
        tenantId: resolved.property.tenantId,
        userId,
        propertyId: resolved.property.id,
        companyId: access.companyId,
        engagementId: access.engagementId,
        entryMethod: "qr",
        qrTokenId: resolved.qr.id,
        checkInLocationStatus: classifyLocation(input.location, resolved.property),
        ...locationColumns(input.location, "checkIn"),
      })
      .returning();
    await audit(db, { tenantId: visit.tenantId, actorUserId: userId, action: "visit.checked_in", entityType: "visit", entityId: visit.id });
    return { visit, created: true };
  } catch (e) {
    // Concurrent duplicate submissions: the database allows one open visit; return it.
    if (!isUniqueViolation(e)) throw e;
    const winner = await openVisitFor(db, userId);
    if (winner && winner.visit.propertyId === resolved.property.id) return { visit: winner.visit, created: false };
    throw new DomainError("open_visit_elsewhere");
  }
}

/** Closes the worker's own open visit. Always closes the original property's visit. */
export async function checkOut(db: DB, userId: string, input: { visitId: string; location: LocationReading }) {
  const [v] = await db.select().from(visits).where(eq(visits.id, input.visitId));
  if (!v || v.userId !== userId) throw new NotAuthorized();
  if (v.checkedOutAt) return { visit: v, closed: false };
  const [prop] = await db.select().from(properties).where(eq(properties.id, v.propertyId));
  const [visit] = await db
    .update(visits)
    .set({ checkedOutAt: new Date(), checkOutLocationStatus: classifyLocation(input.location, prop), ...locationColumns(input.location, "checkOut") })
    .where(and(eq(visits.id, v.id), isNull(visits.checkedOutAt)))
    .returning();
  if (!visit) {
    const [again] = await db.select().from(visits).where(eq(visits.id, v.id));
    return { visit: again, closed: false };
  }
  await audit(db, { tenantId: visit.tenantId, actorUserId: userId, action: "visit.checked_out", entityType: "visit", entityId: visit.id });
  return { visit, closed: true };
}

export function isStale(checkedInAt: Date, now = new Date()): boolean {
  return now.getTime() - checkedInAt.getTime() > STALE_VISIT_HOURS * 3_600_000;
}

/**
 * Attendance board for a manager: everyone currently checked in on the project, with employer,
 * hiring chain and stale flag. Wording in the UI is "checked in", not "present".
 */
export async function attendanceBoard(db: DB, actorId: string, projectId: string, now = new Date()) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new DomainError("not_found");
  await requireTenantManager(db, actorId, project.tenantId);
  const rows = await db
    .select({ visit: visits, property: properties, user: users, companyName: companies.name })
    .from(visits)
    .innerJoin(properties, eq(properties.id, visits.propertyId))
    .innerJoin(users, eq(users.id, visits.userId))
    .innerJoin(companies, eq(companies.id, visits.companyId))
    .where(and(eq(properties.projectId, projectId), eq(visits.tenantId, project.tenantId), isNull(visits.checkedOutAt)))
    .orderBy(asc(properties.label), asc(visits.checkedInAt));
  const out = [];
  for (const r of rows) {
    out.push({
      visitId: r.visit.id,
      propertyLabel: r.property.label,
      address: r.property.address,
      workerName: r.user.displayName || r.user.email,
      phone: r.user.phone,
      companyName: r.companyName,
      chain: await hiringChainNames(db, projectId, r.visit.companyId),
      checkedInAt: r.visit.checkedInAt,
      locationStatus: r.visit.checkInLocationStatus,
      stale: isStale(r.visit.checkedInAt, now),
    });
  }
  return out;
}
