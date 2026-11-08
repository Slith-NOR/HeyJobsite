import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { engagementsWithNames, getProjectForManager, listCompanies, listProperties } from "@/domain/org";
import { STALE_VISIT_HOURS, attendanceBoard } from "@/domain/visits";
import { t, type MessageKey } from "@/i18n";
import { DomainError } from "@/lib/errors";
import { formatTime, requireUser } from "@/lib/session";
import { createEngagementAction, createPropertyAction } from "../../../../actions";
import { ErrorNotice } from "../../../../Notice";

type Props = { params: Promise<{ tenantId: string; projectId: string }>; searchParams: Promise<{ error?: string }> };

export default async function ProjectPage({ params, searchParams }: Props) {
  const { tenantId, projectId } = await params;
  const { error } = await searchParams;
  const user = await requireUser(`/manage/${tenantId}/projects/${projectId}`);
  const lang = user.preferredLanguage;
  const db = await getDb();

  let data;
  try {
    const project = await getProjectForManager(db, user.id, projectId);
    if (project.tenantId !== tenantId) notFound();
    const [houses, engagements, companies, board] = await Promise.all([
      listProperties(db, user.id, projectId),
      engagementsWithNames(db, user.id, projectId),
      listCompanies(db, user.id, tenantId),
      attendanceBoard(db, user.id, projectId),
    ]);
    data = { project, houses, engagements, companies, board };
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { project, houses, engagements, companies, board } = data;
  const onProject = new Set(engagements.map((e) => e.hiredCompanyId));
  const hiringOptions = companies.filter((c) => c.isGeneralContractor || onProject.has(c.id));
  const hiredOptions = companies.filter((c) => !c.isGeneralContractor);

  return (
    <>
      <p className="no-print"><Link href={`/manage/${tenantId}`}>← {t(lang, "manage.projects")}</Link></p>
      <h1>{project.name}</h1>
      <ErrorNotice lang={lang} code={error} />

      <h2>{t(lang, "manage.checkedIn")}</h2>
      {board.length === 0 ? (
        <p className="muted">{t(lang, "manage.nobody")}</p>
      ) : (
        board.map((b) => (
          <div className="card" key={b.visitId}>
            <strong>{b.workerName}</strong> · {b.propertyLabel}
            <div className="chain">{b.chain.join(" → ")}</div>
            <div className="muted">
              {formatTime(b.checkedInAt, project.timezone, lang)} · {t(lang, `location.${b.locationStatus}` as MessageKey)}
            </div>
            {b.stale && <div className="warn">{t(lang, "manage.stale", { hours: STALE_VISIT_HOURS })}</div>}
            {b.phone && <a className="button secondary" href={`tel:${b.phone}`}>{t(lang, "manage.call")}</a>}
          </div>
        ))
      )}

      <h2>{t(lang, "manage.houses")}</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {houses.map((h) => (
              <tr key={h.id}>
                <td><strong>{h.label}</strong><br /><span className="muted">{h.address}</span></td>
                <td><Link href={`/manage/${tenantId}/properties/${h.id}/qr`}>{t(lang, "manage.printQr")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={createPropertyAction} className="card">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor="label">{t(lang, "manage.houseLabel")}</label>
        <input id="label" name="label" required />
        <label htmlFor="address">{t(lang, "manage.address")}</label>
        <input id="address" name="address" required />
        <div className="row">
          <div>
            <label htmlFor="lat">{t(lang, "manage.lat")}</label>
            <input id="lat" name="latitude" inputMode="decimal" />
          </div>
          <div>
            <label htmlFor="lng">{t(lang, "manage.lng")}</label>
            <input id="lng" name="longitude" inputMode="decimal" />
          </div>
        </div>
        <button type="submit">{t(lang, "manage.newHouse")}</button>
      </form>

      <h2>{t(lang, "manage.chain")}</h2>
      {engagements.map((e) => (
        <p key={e.id}>{e.hiringName} → <strong>{e.hiredName}</strong> <span className="muted">({e.scope})</span></p>
      ))}
      <form action={createEngagementAction} className="card">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="projectId" value={projectId} />
        <p><strong>{t(lang, "manage.addEngagement")}</strong></p>
        <div className="row">
          <div>
            <label htmlFor="hiring">{t(lang, "manage.hiringCompany")}</label>
            <select id="hiring" name="hiringCompanyId" required>
              {hiringOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hired">{t(lang, "manage.hiredCompany")}</label>
            <select id="hired" name="hiredCompanyId" required>
              {hiredOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <label htmlFor="scope">{t(lang, "manage.scope")}</label>
        <input id="scope" name="scope" required />
        <div className="row">
          <div>
            <label htmlFor="starts">{t(lang, "manage.startsOn")}</label>
            <input id="starts" name="startsOn" type="date" />
          </div>
          <div>
            <label htmlFor="ends">{t(lang, "manage.endsOn")}</label>
            <input id="ends" name="endsOn" type="date" />
          </div>
        </div>
        <button type="submit">{t(lang, "manage.create")}</button>
      </form>
    </>
  );
}
