import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { userForSession } from "@/domain/auth";
import { isLang, type Lang } from "@/i18n";
import { isProduction } from "./config";

export const SESSION_COOKIE = "px_session";
export const LANG_COOKIE = "px_lang";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForSession(await getDb(), token);
}

export async function requireUser(returnTo?: string) {
  const user = await currentUser();
  if (!user) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  return user;
}

/** Signed-in user's preference, else a language cookie, else the browser's Accept-Language. */
export async function currentLang(): Promise<Lang> {
  const user = await currentUser();
  if (user) return user.preferredLanguage;
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(c)) return c;
  const accept = ((await headers()).get("accept-language") ?? "").toLowerCase();
  if (accept.startsWith("es")) return "es";
  if (accept.startsWith("ht")) return "ht";
  return "en";
}

export async function setSessionCookie(token: string, maxAgeSeconds: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function formatTime(date: Date, timeZone: string, lang: Lang): string {
  const locale = lang === "es" ? "es-US" : "en-US";
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(date);
}
