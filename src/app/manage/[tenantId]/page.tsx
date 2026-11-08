import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getTenantForManager, listCompanies, listProjects } from "@/domain/org";
import { pendingAffiliationsFor } from "@/domain/people";
import { t } from "@/i18n";
import { NotAuthorized } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createCompanyAction, createProjectAction, decideAffiliationAction } from "../../actions";
import { InviteButton } from "../../InviteButton";
import { ErrorNotice } from "../../Notice";

type Props = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ error?: string }> };

export default async function TenantPage({ params, searchParams }: Props) {
  const { tenantId } = await params;
  const { error } = await searchParams;
  const user = await requireUser(`/manage/${tenantId}`);
  const lang = user.preferredLanguage;
  const db = await getDb();
  let data;
  try {
    const tenant = await getTenantForManager(db, user.id, tenantId);
    const [projects, companies, pending] = await Promise.all([
      listProjects(db, user.id, tenantId),
      listCompanies(db, user.id, tenantId),
      pendingAffiliationsFor(db, user.id, tenantId),
    ]);
    data = { tenant, projects, companies, pending };
  } catch (e) {
    if (e instanceof NotAuthorized) notFound();
    throw e;
  }
  const { tenant, projects, companies, pending } = data;
  const back = `/manage/${tenantId}`;

  return (
    <>
      <h1>{t(lang, "manage.title", { tenant: tenant.name })}</h1>
      <ErrorNotice lang={lang} code={error} />

      <h2>{t(lang, "manage.projects")}</h2>
      {projects.map((p) => (
        <p key={p.id}><Link href={`/manage/${tenantId}/projects/${p.id}`}>{p.name}</Link></p>
      ))}
      <form action={createProjectAction} className="card">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label htmlFor="pname">{t(lang, "manage.projectName")}</label>
        <input id="pname" name="name" required />
        <button type="submit">{t(lang, "manage.newProject")}</button>
      </form>

      {pending.length > 0 && (
        <>
          <h2>{t(lang, "home.pendingApprovals")}</h2>
          {pending.map((p) => (
            <div className="card" key={p.affiliation.id}>
              <strong>{p.user.displayName || p.user.email}</strong> <span className="muted">{p.user.email}</span>
              <div>{p.companyName} · {t(lang, p.affiliation.role === "supervisor" ? "home.role.supervisor" : "home.role.worker")}</div>
              <form action={decideAffiliationAction} className="row">
                <input type="hidden" name="affiliationId" value={p.affiliation.id} />
                <input type="hidden" name="back" value={back} />
                <button name="decision" value="approved" type="submit">{t(lang, "home.approve")}</button>
                <button name="decision" value="revoked" type="submit" className="secondary">{t(lang, "home.reject")}</button>
              </form>
            </div>
          ))}
        </>
      )}

      <h2>{t(lang, "manage.companies")}</h2>
      {companies.filter((c) => !c.isGeneralContractor).map((c) => (
        <div className="card" key={c.id}>
          <strong>{c.name}</strong> {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
          <div className="row">
            <InviteButton companyId={c.id} role="supervisor" label={t(lang, "manage.inviteSupervisor")} createdText={t(lang, "home.inviteCreated")} errorText={t(lang, "error.generic")} />
            <InviteButton companyId={c.id} role="worker" label={t(lang, "manage.inviteWorker")} createdText={t(lang, "home.inviteCreated")} errorText={t(lang, "error.generic")} />
          </div>
        </div>
      ))}
      <form action={createCompanyAction} className="card">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="row">
          <div>
            <label htmlFor="cname">{t(lang, "manage.companyName")}</label>
            <input id="cname" name="name" required />
          </div>
          <div>
            <label htmlFor="cphone">{t(lang, "manage.phone")}</label>
            <input id="cphone" name="phone" type="tel" />
          </div>
        </div>
        <button type="submit">{t(lang, "manage.newCompany")}</button>
      </form>
    </>
  );
}
