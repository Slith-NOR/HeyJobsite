import { en, type MessageKey } from "./en";
import { es } from "./es";
import { ht } from "./ht";

export type Lang = "en" | "es" | "ht";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ht", label: "Kreyòl ayisyen" },
];

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, es, ht };

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "es" || v === "ht";
}

export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Maps a DomainError code to a translated message, falling back to a generic one. */
export function errorMessage(lang: Lang, code: string): string {
  const key = `error.${code}` as MessageKey;
  return key in en ? t(lang, key) : t(lang, "error.generic");
}

export type { MessageKey };

/** Translated labels for the passkey buttons (client components take plain strings). */
export function passkeyLabels(lang: Lang, button: MessageKey) {
  return {
    button: t(lang, button),
    working: t(lang, "passkey.working"),
    cancelled: t(lang, "passkey.cancelled"),
    failed: t(lang, "passkey.failed"),
  };
}
