import Link from "next/link";
import { getDb } from "@/db";
import { checkInContext, resolveQrToken } from "@/domain/visits";
import { t } from "@/i18n";
import { currentLang, currentUser, formatTime, requireLanguageChosen } from "@/lib/session";
import { checkInAction, checkOutAction } from "../../actions";
import { ErrorNotice } from "../../Notice";
import { LocationSubmit } from "./LocationSubmit";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; done?: string }> };

/**
 * QR landing page. Signed-out visitors see no site details. Signed-in users without approved
 * access see only a generic message. The address is shown for explicit confirmation.
 */
export default async function QrPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const [user, lang] = await Promise.all([currentUser(), currentLang()]);
  const db = await getDb();
  const self = `/q/${encodeURIComponent(token)}`;
  requireLanguageChosen(user, self);

  if (!user) {
    const exists = await resolveQrToken(db, token);
    if (!exists) return <p className="notice error">{t(lang, "checkin.unavailable")}</p>;
    return (
      <>
        <h1>{t(lang, "checkin.title")}</h1>
        <p>{t(lang, "checkin.signIn")}</p>
        <Link className="button big" href={`/login?next=${encodeURIComponent(self)}`}>{t(lang, "login.title")}</Link>
      </>
    );
  }

  const ctx = await checkInContext(db, user.id, token);
  if (ctx.state === "unavailable") return <p className="notice error">{t(lang, "checkin.unavailable")}</p>;
  if (ctx.state === "not_authorized") return <p className="notice error">{t(lang, "checkin.notAuthorized")}</p>;

  const tz = ctx.timezone;
  const explain = t(lang, "checkin.locationExplain");
  return (
    <>
      <h1>{t(lang, "checkin.title")}</h1>
      <ErrorNotice lang={lang} code={sp.error} />
      {sp.done === "in" && ctx.openVisit && <p className="notice">{t(lang, "checkin.done", { time: formatTime(ctx.openVisit.visit.checkedInAt, tz, lang) })}</p>}
      {sp.done === "out" && <p className="notice">{t(lang, "checkin.outDone", { time: formatTime(new Date(), tz, lang) })}</p>}

      <div className="card">
        <p>{t(lang, "checkin.confirmAddress")}</p>
        <p style={{ fontSize: "1.3rem" }}><strong>{ctx.property.label}</strong><br />{ctx.property.address}</p>
        <p className="muted">{t(lang, "checkin.you")}: {user.displayName || user.email}<br />{t(lang, "checkin.company")}: {ctx.companyName}</p>
      </div>

      {ctx.state === "ready" && (
        <form action={checkInAction}>
          <input type="hidden" name="token" value={token} />
          <LocationSubmit label={t(lang, "checkin.button")} workingLabel={t(lang, "checkin.locationWorking")} explain={explain} />
        </form>
      )}
      {ctx.state === "checked_in_here" && ctx.openVisit && (
        <form action={checkOutAction}>
          <p>{t(lang, "checkin.here", { time: formatTime(ctx.openVisit.visit.checkedInAt, tz, lang) })}</p>
          <input type="hidden" name="visitId" value={ctx.openVisit.visit.id} />
          <input type="hidden" name="back" value={self} />
          <LocationSubmit label={t(lang, "checkin.outButton")} workingLabel={t(lang, "checkin.locationWorking")} explain={explain} />
        </form>
      )}
      {ctx.state === "checked_in_elsewhere" && ctx.openVisit && (
        <form action={checkOutAction} className="card">
          <p className="warn">{t(lang, "checkin.elsewhere", { property: ctx.openVisit.property.label })}</p>
          <input type="hidden" name="visitId" value={ctx.openVisit.visit.id} />
          <input type="hidden" name="back" value={self} />
          <LocationSubmit
            label={t(lang, "checkin.checkOutThere", { property: ctx.openVisit.property.label })}
            workingLabel={t(lang, "checkin.locationWorking")}
            explain={explain}
          />
        </form>
      )}
    </>
  );
}
