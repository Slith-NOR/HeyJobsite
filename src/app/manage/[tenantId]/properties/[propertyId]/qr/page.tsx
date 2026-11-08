import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { activeQrTokensForProperty } from "@/domain/visits";
import { t } from "@/i18n";
import { appBaseUrl } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createQrAction, revokeQrAction } from "../../../../../actions";
import { ErrorNotice } from "../../../../../Notice";
import { PrintButton } from "./PrintButton";

type Props = { params: Promise<{ tenantId: string; propertyId: string }>; searchParams: Promise<{ error?: string }> };

/** Printable QR sign for one house. The QR encodes only an opaque token URL. */
export default async function QrSheet({ params, searchParams }: Props) {
  const { tenantId, propertyId } = await params;
  const { error } = await searchParams;
  const user = await requireUser(`/manage/${tenantId}/properties/${propertyId}/qr`);
  const lang = user.preferredLanguage;
  let data;
  try {
    data = await activeQrTokensForProperty(await getDb(), user.id, propertyId);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { property, tokens } = data;
  if (property.tenantId !== tenantId) notFound();
  const current = tokens[0];
  const url = current ? `${appBaseUrl()}/q/${current.token}` : null;
  const svg = url ? await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" }) : null;

  return (
    <>
      <p className="no-print"><Link href={`/manage/${tenantId}/projects/${property.projectId}`}>← {t(lang, "manage.houses")}</Link></p>
      <ErrorNotice lang={lang} code={error} />
      {svg && url ? (
        <div className="print-sheet card">
          <h1>{property.label}</h1>
          <p>{property.address}</p>
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          {/* The sign is read by everyone on site, so instructions are printed in all three languages. */}
          <p><strong>{t("en", "manage.qrInstructions")}</strong><br />{t("es", "manage.qrInstructions")}<br />{t("ht", "manage.qrInstructions")}</p>
          <code className="link no-print">{url}</code>
        </div>
      ) : null}
      <div className="row no-print">
        {svg && <PrintButton label={t(lang, "manage.print")} />}
        <form action={createQrAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="propertyId" value={propertyId} />
          <button type="submit" className="secondary">{t(lang, "manage.newQr")}</button>
        </form>
        {current && (
          <form action={revokeQrAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="qrTokenId" value={current.id} />
            <button type="submit" className="secondary">{t(lang, "manage.revokeQr")}</button>
          </form>
        )}
      </div>
    </>
  );
}
