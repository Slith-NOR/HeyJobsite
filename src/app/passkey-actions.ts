"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { SESSION_COOKIE_DAYS, needsLanguageChoice, revokeOtherSessions, safeReturnTo } from "@/domain/auth";
import {
  CHALLENGE_MINUTES,
  beginPasskeyLogin,
  beginPasskeyRegistration,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  relyingPartyFor,
  removePasskey,
} from "@/domain/passkeys";
import { errorMessage } from "@/i18n";
import { appBaseUrl, isProduction, passkeyRpId } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { SESSION_COOKIE, currentLang, requireUser, setSessionCookie } from "@/lib/session";

const CHALLENGE_COOKIE = "px_webauthn";
const rp = () => relyingPartyFor(appBaseUrl(), passkeyRpId());

async function setChallengeCookie(id: string) {
  (await cookies()).set(CHALLENGE_COOKIE, id, {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction(),
    path: "/",
    maxAge: CHALLENGE_MINUTES * 60,
  });
}

async function takeChallengeCookie() {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value ?? "";
  jar.delete(CHALLENGE_COOKIE);
  return id;
}

type Failure = { error: string };

async function failure(e: unknown): Promise<Failure> {
  if (e instanceof DomainError) return { error: errorMessage(await currentLang(), e.code) };
  throw e;
}

export async function beginPasskeyRegistrationAction() {
  const user = await requireUser();
  const { challengeId, options } = await beginPasskeyRegistration(await getDb(), user.id, rp());
  await setChallengeCookie(challengeId);
  return options;
}

export async function finishPasskeyRegistrationAction(response: RegistrationResponseJSON): Promise<{ ok: true } | Failure> {
  const user = await requireUser();
  try {
    await finishPasskeyRegistration(await getDb(), user.id, await takeChallengeCookie(), response, rp());
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function beginPasskeyLoginAction() {
  const { challengeId, options } = await beginPasskeyLogin(await getDb(), rp());
  await setChallengeCookie(challengeId);
  return options;
}

export async function finishPasskeyLoginAction(
  response: AuthenticationResponseJSON,
  next: string,
): Promise<{ redirectTo: string } | Failure> {
  try {
    const { sessionToken, user } = await finishPasskeyLogin(await getDb(), await takeChallengeCookie(), response, rp());
    await setSessionCookie(sessionToken, SESSION_COOKIE_DAYS * 86400);
    const target = safeReturnTo(next) ?? "/";
    return { redirectTo: needsLanguageChoice(user) ? `/welcome?next=${encodeURIComponent(target)}` : target };
  } catch (e) {
    return failure(e);
  }
}

export async function removePasskeyAction(fd: FormData) {
  const user = await requireUser("/settings");
  try {
    await removePasskey(await getDb(), user.id, String(fd.get("passkeyId") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) redirect(`/settings?error=${e.code}`);
    throw e;
  }
  redirect("/settings?removed=1");
}

export async function signOutOtherDevicesAction() {
  const user = await requireUser("/settings");
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const count = await revokeOtherSessions(await getDb(), user.id, token);
  redirect(`/settings?signedOut=${count}`);
}
