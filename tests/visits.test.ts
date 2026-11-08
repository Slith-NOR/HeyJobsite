import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { visits } from "@/db/schema";
import { attendanceBoard, checkIn, checkInContext, checkOut, classifyLocation, isStale, revokeQrToken } from "@/domain/visits";
import { freshDb, seedTwoTenants } from "./helpers";

const noLocation = { permission: "denied" as const };

describe("QR check-in", () => {
  it("checks in with a server timestamp and employer snapshot; a repeat scan is idempotent", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const first = await checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation });
    expect(first.created).toBe(true);
    expect(first.visit.companyId).toBe(s.drain.id);
    expect(first.visit.checkInLocationStatus).toBe("denied");
    const again = await checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation });
    expect(again.created).toBe(false);
    expect(again.visit.id).toBe(first.visit.id);
  });

  it("concurrent submissions create exactly one visit", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const results = await Promise.all(Array.from({ length: 5 }, () => checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation })));
    const ids = new Set(results.map((r) => r.visit.id));
    expect(ids.size).toBe(1);
    const open = await db.select().from(visits).where(and(eq(visits.userId, s.john.id), isNull(visits.checkedOutAt)));
    expect(open).toHaveLength(1);
  });

  it("a second property requires checking out first; history is not rewritten", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const v = await checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation });
    await expect(checkIn(db, s.john.id, { token: s.qr8.token, location: noLocation })).rejects.toThrow("open_visit_elsewhere");
    const ctx = await checkInContext(db, s.john.id, s.qr8.token);
    expect(ctx.state).toBe("checked_in_elsewhere");
    await checkOut(db, s.john.id, { visitId: v.visit.id, location: noLocation });
    const v8 = await checkIn(db, s.john.id, { token: s.qr8.token, location: noLocation });
    expect(v8.visit.propertyId).toBe(s.house8.id);
    const [old] = await db.select().from(visits).where(eq(visits.id, v.visit.id));
    expect(old.propertyId).toBe(s.house12.id);
    expect(old.checkedOutAt).not.toBeNull();
  });

  it("revoked and unknown QR links fail safely", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    await revokeQrToken(db, s.adminA, s.qr12.id);
    await expect(checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation })).rejects.toThrow("qr_unavailable");
    expect((await checkInContext(db, s.john.id, s.qr12.token)).state).toBe("unavailable");
    expect((await checkInContext(db, s.john.id, "garbage")).state).toBe("unavailable");
  });

  it("a QR code does not authorize: workers from other tenants or pending workers cannot check in", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    await expect(checkIn(db, s.john.id, { token: s.qrB.token, location: noLocation })).rejects.toThrow("Not authorized");
    // Managers are not checked in as workers via QR.
    await expect(checkIn(db, s.adminA, { token: s.qr12.token, location: noLocation })).rejects.toThrow("Not authorized");
  });

  it("only the worker can check out their own visit", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    const v = await checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation });
    await expect(checkOut(db, s.adminA, { visitId: v.visit.id, location: noLocation })).rejects.toThrow("Not authorized");
  });
});

describe("location classification", () => {
  const house = { latitude: 40.0, longitude: -75.0 };
  const at = (lat: number, lon: number, acc: number) => ({ permission: "granted" as const, latitude: lat, longitude: lon, accuracyM: acc, capturedAt: new Date() });

  it("never reports denial or missing data as verified", () => {
    expect(classifyLocation({ permission: "denied" }, house)).toBe("denied");
    expect(classifyLocation({ permission: "unavailable" }, house)).toBe("unavailable");
    expect(classifyLocation(at(40, -75, 500), house)).toBe("low_accuracy");
    expect(classifyLocation(at(40, -75, 10), { latitude: null, longitude: null })).toBe("no_reference");
  });

  it("matches nearby readings and flags distant ones", () => {
    expect(classifyLocation(at(40.0002, -75.0002, 15), house)).toBe("matched"); // ~28 m
    expect(classifyLocation(at(40.01, -75.0, 15), house)).toBe("mismatch"); // ~1.1 km
  });
});

describe("attendance board", () => {
  it("shows checked-in workers with chain and stale status to the tenant's manager only", async () => {
    const db = await freshDb();
    const s = await seedTwoTenants(db);
    await checkIn(db, s.john.id, { token: s.qr12.token, location: noLocation });
    const board = await attendanceBoard(db, s.adminA, s.projectA.id);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ propertyLabel: "House 12", companyName: "Drain Sub", chain: ["Alpha Builders", "Plumbing Co", "Drain Sub"], stale: false });
    const later = new Date(Date.now() + 13 * 3_600_000);
    expect((await attendanceBoard(db, s.adminA, s.projectA.id, later))[0].stale).toBe(true);
    await expect(attendanceBoard(db, s.adminB, s.projectA.id)).rejects.toThrow("Not authorized");
  });

  it("stale threshold", () => {
    const now = new Date("2026-11-08T20:00:00Z");
    expect(isStale(new Date("2026-11-08T07:00:00Z"), now)).toBe(true);
    expect(isStale(new Date("2026-11-08T09:00:00Z"), now)).toBe(false);
  });
});
