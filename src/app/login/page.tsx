import { redirect } from "next/navigation";
import { safeReturnTo } from "@/domain/auth";
import { LANGS, passkeyLabels, t } from "@/i18n";
import { devToolsEnabled } from "@/lib/config";
import { currentLang, currentUser } from "@/lib/session";
import { requestLoginAction, setLanguageAction } from "../actions";
import { ErrorNotice } from "../Notice";
import { PasskeySignIn } from "../PasskeyButtons";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const lang = await currentLang();
  // Already signed in on this device (sessions are remembered): go straight on.
  if (await currentUser()) redirect(safeReturnTo(sp.next) ?? "/");
  const back = `/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`;
  return (
    <>
      <form action={setLanguageAction} className="row no-print" aria-label="Language">
        <input type="hidden" name="back" value={back} />
        {LANGS.map((l) => (
          <button key={l.code} name="lang" value={l.code} className={l.code === lang ? "" : "secondary"} type="submit">
            {l.label}
          </button>
        ))}
      </form>
      <h1>{t(lang, "login.title")}</h1>
      <ErrorNotice lang={lang} code={sp.error} />
      {sp.sent ? (
        <div className="card">
          <p>{t(lang, "login.sent")}</p>
          {devToolsEnabled() && <p className="muted">{t(lang, "login.devHint")} <a href="/dev/inbox">/dev/inbox</a></p>}
        </div>
      ) : (
        <>
          <PasskeySignIn next={sp.next ?? ""} labels={passkeyLabels(lang, "login.passkey")} />
          <form action={requestLoginAction} className="card">
            <p>{t(lang, "login.emailIntro")}</p>
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <input type="hidden" name="invite" value={sp.invite ?? ""} />
            <label htmlFor="email">{t(lang, "login.email")}</label>
            <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
            <button className="big" type="submit">{t(lang, "login.send")}</button>
          </form>
        </>
      )}
    </>
  );
}
