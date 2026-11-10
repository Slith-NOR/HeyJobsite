import Link from "next/link";
import { getDb } from "@/db";
import { describeInvite } from "@/domain/people";
import { t } from "@/i18n";
import { currentLang, currentUser, requireLanguageChosen } from "@/lib/session";
import { acceptInviteAction } from "../../actions";
import { ErrorNotice } from "../../Notice";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> };

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error } = await searchParams;
  const [lang, user] = await Promise.all([currentLang(), currentUser()]);
  requireLanguageChosen(user, `/invite/${encodeURIComponent(token)}`);
  const invite = await describeInvite(await getDb(), token);

  if (!invite || !invite.usable) return <p className="notice error">{t(lang, "invite.invalid")}</p>;

  return (
    <>
      <h1>{t(lang, "invite.title", { company: invite.companyName })}</h1>
      <ErrorNotice lang={lang} code={error} />
      <p>{t(lang, "invite.body", { company: invite.companyName, tenant: invite.tenantName })}</p>
      {user ? (
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <button className="big" type="submit">{t(lang, "invite.accept")}</button>
        </form>
      ) : (
        <div className="card">
          <p>{t(lang, "invite.signInFirst")}</p>
          <Link className="button" href={`/login?invite=${encodeURIComponent(token)}`}>{t(lang, "login.title")}</Link>
        </div>
      )}
    </>
  );
}
