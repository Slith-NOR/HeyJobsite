"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { SESSION_DAYS, consumeLoginLink, requestLoginLink, revokeSession, safeReturnTo, updateProfile } from "@/domain/auth";
import { createCompany, createEngagement, createProject, createProperty } from "@/domain/org";
import { createInvite, decideAffiliation, describeInvite, redeemInvite } from "@/domain/people";
import { type LocationReading, checkIn, checkOut, createQrToken, revokeQrToken } from "@/domain/visits";
import { isLang } from "@/i18n";
import { appBaseUrl } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { LANG_COOKIE, SESSION_COOKIE, currentLang, requireUser, setSessionCookie } from "@/lib/session";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Runs an action and turns expected domain errors into ?error=code on the given page. */
async function attempt(back: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(e.code)}`);
    throw e;
  }
}

function readLocation(fd: FormData): LocationReading {
  const p = str(fd, "locPermission");
  if (p === "granted") {
    const latitude = num(fd, "locLat");
    const longitude = num(fd, "locLng");
    const accuracyM = num(fd, "locAcc");
    const ts = num(fd, "locTs");
    if (latitude == null || longitude == null || accuracyM == null) return { permission: "unavailable" };
    // Device-reported capture time is a claim; clamp to "not in the future".
    const capturedAt = ts ? new Date(Math.min(ts, Date.now())) : new Date();
    return { permission: "granted", latitude, longitude, accuracyM, capturedAt };
  }
  if (p === "denied") return { permission: "denied" };
  if (p === "unavailable") return { permission: "unavailable" };
  return { permission: "not_requested" };
}

// ---------- Auth ----------

export async function requestLoginAction(fd: FormData) {
  const next = safeReturnTo(str(fd, "next"));
  const inviteToken = str(fd, "invite");
  const db = await getDb();
  const back = `/login?${new URLSearchParams({ ...(next ? { next } : {}) })}`;
  await attempt(back, async () => {
    const invite = inviteToken ? await describeInvite(db, inviteToken) : null;
    await requestLoginLink(db, {
      email: str(fd, "email"),
      baseUrl: appBaseUrl(),
      lang: await currentLang(),
      inviteId: invite?.usable ? invite.id : null,
      returnTo: next,
    });
  });
  redirect("/login?sent=1");
}

export async function consumeLoginAction(fd: FormData) {
  const db = await getDb();
  let target = "/";
  try {
    const { sessionToken, returnTo } = await consumeLoginLink(db, str(fd, "token"));
    await setSessionCookie(sessionToken, SESSION_DAYS * 86400);
    target = returnTo ?? "/";
  } catch (e) {
    if (e instanceof DomainError) redirect("/login?error=login_link_invalid");
    throw e;
  }
  redirect(target);
}

export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(await getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function setLanguageAction(fd: FormData) {
  const lang = str(fd, "lang");
  if (isLang(lang)) (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  redirect(safeReturnTo(str(fd, "back")) ?? "/");
}

export async function saveSettingsAction(fd: FormData) {
  const user = await requireUser();
  const lang = str(fd, "lang");
  await updateProfile(await getDb(), user.id, {
    displayName: str(fd, "displayName"),
    phone: str(fd, "phone") || null,
    preferredLanguage: isLang(lang) ? lang : undefined,
    translationEnabled: fd.get("translate") === "on",
  });
  redirect("/settings?saved=1");
}

// ---------- Invites and approvals ----------

export async function acceptInviteAction(fd: FormData) {
  const token = str(fd, "token");
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);
  await attempt(`/invite/${encodeURIComponent(token)}`, async () => {
    await redeemInvite(await getDb(), user.id, { token });
  });
  redirect("/?accepted=1");
}

export type InviteState = { link?: string; svg?: string; error?: string } | null;

export async function createInviteAction(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const user = await requireUser();
  try {
    const role = str(fd, "role") === "supervisor" ? "supervisor" : "worker";
    const { token } = await createInvite(await getDb(), user.id, { companyId: str(fd, "companyId"), role });
    const link = `${appBaseUrl()}/invite/${token}`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 1, width: 220 });
    return { link, svg };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.code };
    throw e;
  }
}

export async function decideAffiliationAction(fd: FormData) {
  const user = await requireUser();
  const back = safeReturnTo(str(fd, "back")) ?? "/";
  await attempt(back, async () => {
    await decideAffiliation(await getDb(), user.id, str(fd, "affiliationId"), str(fd, "decision") === "approved" ? "approved" : "revoked");
  });
  redirect(back);
}

// ---------- Management ----------

export async function createProjectAction(fd: FormData) {
  const user = await requireUser();
  const tenantId = str(fd, "tenantId");
  await attempt(`/manage/${tenantId}`, async () => {
    await createProject(await getDb(), user.id, tenantId, { name: str(fd, "name") });
  });
  redirect(`/manage/${tenantId}`);
}

export async function createCompanyAction(fd: FormData) {
  const user = await requireUser();
  const tenantId = str(fd, "tenantId");
  await attempt(`/manage/${tenantId}`, async () => {
    await createCompany(await getDb(), user.id, tenantId, { name: str(fd, "name"), phone: str(fd, "phone") });
  });
  redirect(`/manage/${tenantId}`);
}

export async function createPropertyAction(fd: FormData) {
  const user = await requireUser();
  const back = `/manage/${str(fd, "tenantId")}/projects/${str(fd, "projectId")}`;
  await attempt(back, async () => {
    await createProperty(await getDb(), user.id, str(fd, "projectId"), {
      label: str(fd, "label"),
      address: str(fd, "address"),
      latitude: num(fd, "latitude"),
      longitude: num(fd, "longitude"),
    });
  });
  redirect(back);
}

export async function createEngagementAction(fd: FormData) {
  const user = await requireUser();
  const back = `/manage/${str(fd, "tenantId")}/projects/${str(fd, "projectId")}`;
  await attempt(back, async () => {
    await createEngagement(await getDb(), user.id, {
      projectId: str(fd, "projectId"),
      hiringCompanyId: str(fd, "hiringCompanyId"),
      hiredCompanyId: str(fd, "hiredCompanyId"),
      scope: str(fd, "scope"),
      startsOn: str(fd, "startsOn") || null,
      endsOn: str(fd, "endsOn") || null,
    });
  });
  redirect(back);
}

export async function createQrAction(fd: FormData) {
  const user = await requireUser();
  const back = `/manage/${str(fd, "tenantId")}/properties/${str(fd, "propertyId")}/qr`;
  await attempt(back, async () => {
    await createQrToken(await getDb(), user.id, str(fd, "propertyId"));
  });
  redirect(back);
}

export async function revokeQrAction(fd: FormData) {
  const user = await requireUser();
  const back = `/manage/${str(fd, "tenantId")}/properties/${str(fd, "propertyId")}/qr`;
  await attempt(back, async () => {
    await revokeQrToken(await getDb(), user.id, str(fd, "qrTokenId"));
  });
  redirect(back);
}

// ---------- Check-in ----------

export async function checkInAction(fd: FormData) {
  const token = str(fd, "token");
  const back = `/q/${encodeURIComponent(token)}`;
  const user = await requireUser(back);
  await attempt(back, async () => {
    await checkIn(await getDb(), user.id, { token, location: readLocation(fd) });
  });
  redirect(`${back}?done=in`);
}

export async function checkOutAction(fd: FormData) {
  const back = safeReturnTo(str(fd, "back")) ?? "/";
  const user = await requireUser(back);
  await attempt(back, async () => {
    await checkOut(await getDb(), user.id, { visitId: str(fd, "visitId"), location: readLocation(fd) });
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}done=out`);
}
