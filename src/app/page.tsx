import Link from "next/link";
import { getDb } from "@/db";
import { myTenants } from "@/domain/org";
import { myAffiliations, pendingAffiliationsFor } from "@/domain/people";
import { openVisitFor } from "@/domain/visits";
import { t } from "@/i18n";
import { requireUser } from "@/lib/session";
import { checkOutAction, decideAffiliationAction } from "./actions";
import { InviteButton } from "./InviteButton";
import { ErrorNotice } from "./Notice";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const lang = user.preferredLanguage;
  const db = await getDb();
  const [tenants, affiliations, pending, open] = await Promise.all([
    myTenants(db, user.id),
    myAffiliations(db, user.id),
    pendingAffiliationsFor(db, user.id),
    openVisitFor(db, user.id),
  ]);
  const supervised = affiliations.filter((a) => a.affiliation.status === "approved" && a.affiliation.role === "supervisor");

  return (
    <>
      <h1>{t(lang, "home.welcome", { name: user.displayName || user.email })}</h1>
      <ErrorNotice lang={lang} code={sp.error} />
      {sp.accepted && <p className="notice">{t(lang, "invite.accepted")}</p>}

      {open ? (
        <div className="card">
          <p><strong>{t(lang, "home.openVisit", { property: `${open.property.label}, ${open.property.address}` })}</strong></p>
          <form action={checkOutAction}>
            <input type="hidden" name="visitId" value={open.visit.id} />
            <input type="hidden" name="back" value="/" />
            <input type="hidden" name="locPermission" value="not_requested" />
            <button className="big" type="submit">{t(lang, "checkin.outButton")}</button>
          </form>
        </div>
      ) : (
        affiliations.length > 0 && <p className="muted">{t(lang, "home.scanHint")}</p>
      )}

      {tenants.length > 0 && (
        <div className="card">
          {tenants.map((m) => (
            <p key={m.tenant.id}><Link href={`/manage/${m.tenant.id}`}>{t(lang, "home.manage", { tenant: m.tenant.name })}</Link></p>
          ))}
        </div>
      )}

      <h2>{t(lang, "home.myCompanies")}</h2>
      {affiliations.length === 0 && tenants.length === 0 && <p className="muted">{t(lang, "home.noCompanies")}</p>}
      {affiliations.map((a) => (
        <div className="card" key={a.affiliation.id}>
          <strong>{a.companyName}</strong> <span className="muted">· {a.tenantName}</span>
          <div>
            {t(lang, a.affiliation.role === "supervisor" ? "home.role.supervisor" : "home.role.worker")} ·{" "}
            <span className={a.affiliation.status === "approved" ? "ok" : "warn"}>
              {t(lang, a.affiliation.status === "approved" ? "home.status.approved" : "home.status.pending")}
            </span>
          </div>
          {supervised.some((s) => s.affiliation.id === a.affiliation.id) && (
            <InviteButton
              companyId={a.affiliation.companyId}
              role="worker"
              label={t(lang, "home.inviteWorker")}
              createdText={t(lang, "home.inviteCreated")}
              errorText={t(lang, "error.generic")}
            />
          )}
        </div>
      ))}

      {pending.length > 0 && (
        <>
          <h2>{t(lang, "home.pendingApprovals")}</h2>
          {pending.map((p) => (
            <div className="card" key={p.affiliation.id}>
              <strong>{p.user.displayName || p.user.email}</strong> <span className="muted">{p.user.email}</span>
              <div>{p.companyName} · {t(lang, p.affiliation.role === "supervisor" ? "home.role.supervisor" : "home.role.worker")}</div>
              <form action={decideAffiliationAction} className="row">
                <input type="hidden" name="affiliationId" value={p.affiliation.id} />
                <input type="hidden" name="back" value="/" />
                <button name="decision" value="approved" type="submit">{t(lang, "home.approve")}</button>
                <button name="decision" value="revoked" type="submit" className="secondary">{t(lang, "home.reject")}</button>
              </form>
            </div>
          ))}
        </>
      )}
    </>
  );
}
