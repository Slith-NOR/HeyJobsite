import { LANGS, t } from "@/i18n";
import { requireUser } from "@/lib/session";
import { saveSettingsAction } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const user = await requireUser("/settings");
  const lang = user.preferredLanguage;
  return (
    <>
      <h1>{t(lang, "settings.title")}</h1>
      {saved && <p className="notice">{t(lang, "settings.saved")}</p>}
      <form action={saveSettingsAction} className="card">
        <label htmlFor="displayName">{t(lang, "settings.name")}</label>
        <input id="displayName" name="displayName" defaultValue={user.displayName} autoComplete="name" />
        <label htmlFor="phone">{t(lang, "settings.phone")}</label>
        <input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" />
        <label htmlFor="lang">{t(lang, "settings.language")}</label>
        <select id="lang" name="lang" defaultValue={lang}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <label>
          <input type="checkbox" name="translate" defaultChecked={user.translationEnabled} />
          {t(lang, "settings.translate")}
        </label>
        <button type="submit">{t(lang, "settings.save")}</button>
      </form>
    </>
  );
}
