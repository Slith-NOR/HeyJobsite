import { errorMessage, type Lang } from "@/i18n";

/** Renders a translated error from a ?error=code query parameter. */
export function ErrorNotice({ lang, code }: { lang: Lang; code?: string | string[] }) {
  if (!code || Array.isArray(code)) return null;
  return <p className="notice error" role="alert">{errorMessage(lang, code)}</p>;
}
