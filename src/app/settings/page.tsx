import { getDb } from "@/db";
import { listPasskeys } from "@/domain/passkeys";
import { LANGS, passkeyLabels, t } from "@/i18n";
import { requireUser } from "@/lib/session";
import { saveSettingsAction } from "../actions";
import { ErrorNotice } from "../Notice";
import { PasskeySetup } from "../PasskeyButtons";
import { removePasskeyAction, signOutOtherDevicesAction } from "../passkey-actions";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const shortDate = (d: Date, lang: string) =>
  new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);

export default async function SettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requireUser("/settings");
  const lang = user.preferredLanguage;
  const keys = await listPasskeys(await getDb(), user.id);
  return (
    <>
      <h1>{t(lang, "settings.title")}</h1>
      <ErrorNotice lang={lang} code={sp.error} />
      {sp.saved && <p className="notice">{t(lang, "settings.saved")}</p>}
      {sp.added && <p className="notice">{t(lang, "passkey.added")}</p>}
      {sp.removed && <p className="notice">{t(lang, "settings.passkeyRemoved")}</p>}
      {sp.signedOut !== undefined && <p className="notice">{t(lang, "settings.signedOutOthers", { count: Number(sp.signedOut) || 0 })}</p>}

      <form action={saveSettingsAction} className="card">
        <label htmlFor="displayName">{t(lang, "settings.name")}</label>
        <input id="displayName" name="displayName" defaultValue={user.displayName} autoComplete="name" />
        <label htmlFor="phone">{t(lang, "settings.phone")}</label>
        <input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" />
        <label htmlFor="lang">{t(lang, "settings.language")}</label>
        <select id="lang" name="lang" defaultValue={lang}>
          {LANGS.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
        </select>
        <label>
          <input type="checkbox" name="translate" defaultChecked={user.translationEnabled} />
          {t(lang, "settings.translate")}
        </label>
        <button type="submit">{t(lang, "settings.save")}</button>
      </form>

      <h2>{t(lang, "settings.security")}</h2>
      <p className="muted">{t(lang, "settings.staySignedIn")}</p>
      <div className="card">
        <h3>{t(lang, "settings.passkeys")}</h3>
        {keys.length === 0 && <p className="muted">{t(lang, "settings.noPasskeys")}</p>}
        {keys.map((k) => (
          <form key={k.id} action={removePasskeyAction} className="row">
            <input type="hidden" name="passkeyId" value={k.id} />
            <span>
              {t(lang, "settings.passkeyAdded", { date: shortDate(k.createdAt, lang) })}
              {k.lastUsedAt && <> · {t(lang, "settings.passkeyUsed", { date: shortDate(k.lastUsedAt, lang) })}</>}
              {k.deviceType === "multiDevice" && <> · <span className="muted">{t(lang, "settings.passkeySynced")}</span></>}
            </span>
            <button type="submit" className="secondary">{t(lang, "settings.removePasskey")}</button>
          </form>
        ))}
      </div>
      <PasskeySetup labels={passkeyLabels(lang, "settings.addPasskey")} doneHref="/settings?added=1" />
      <form action={signOutOtherDevicesAction} className="card">
        <p className="muted">{t(lang, "settings.signOutOthersHint")}</p>
        <button type="submit" className="secondary">{t(lang, "settings.signOutOthers")}</button>
      </form>
    </>
  );
}
