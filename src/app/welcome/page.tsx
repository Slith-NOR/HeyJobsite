import { redirect } from "next/navigation";
import { safeReturnTo } from "@/domain/auth";
import { LANGS, t } from "@/i18n";
import { currentUser } from "@/lib/session";
import { chooseLanguageAction } from "../actions";

/**
 * First sign-in: the person picks their language. Every heading and option is written in its
 * own language, because we do not know yet which one the reader understands.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnTo((await searchParams).next) ?? "/";
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return (
    <>
      <h1>
        {LANGS.map((l) => (
          <span key={l.code} lang={l.code} style={{ display: "block" }}>{t(l.code, "welcome.title")}</span>
        ))}
      </h1>
      <form action={chooseLanguageAction} className="stack">
        <input type="hidden" name="next" value={next} />
        {LANGS.map((l) => (
          <button key={l.code} className="big" type="submit" name="lang" value={l.code} lang={l.code}>
            {l.label}
          </button>
        ))}
      </form>
      {LANGS.map((l) => (
        <p key={l.code} lang={l.code} className="muted">{t(l.code, "welcome.hint")}</p>
      ))}
    </>
  );
}
