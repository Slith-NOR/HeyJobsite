import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { t } from "@/i18n";
import { devToolsEnabled } from "@/lib/config";
import { currentLang, currentUser } from "@/lib/session";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Project X", description: "Construction site check-in and accountability" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, lang] = await Promise.all([currentUser(), currentLang()]);
  return (
    <html lang={lang}>
      <body>
        <header className="top">
          <Link href="/" className="brand">{t(lang, "app.name")}</Link>
          {user && <Link href="/settings">{t(lang, "nav.settings")}</Link>}
          {devToolsEnabled() && <Link href="/dev/inbox">{t(lang, "nav.devInbox")}</Link>}
          {user && (
            <form action={signOutAction}>
              <button className="link" type="submit">{t(lang, "nav.signOut")}</button>
            </form>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
