import { t } from "@/i18n";
import { currentLang } from "@/lib/session";
import { consumeLoginAction } from "../../actions";

/**
 * The emailed link opens this page; signing in needs a button press (POST), so email
 * link scanners that prefetch URLs cannot use up the single-use token.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const lang = await currentLang();
  return (
    <>
      <h1>{t(lang, "login.verifyTitle")}</h1>
      <form action={consumeLoginAction} className="card">
        <input type="hidden" name="token" value={token ?? ""} />
        <button className="big" type="submit">{t(lang, "login.verifyButton")}</button>
      </form>
    </>
  );
}
