import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppFrame from "@/components/app-frame";
import ThemeProvider from "@/components/theme-provider";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { ensureBackupEngineStarted } from "@/lib/backups/engine";
import { buildThemeBootstrapScript } from "@/lib/ui/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProxCenter",
  description: "Dashboard Proxmox personnel",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  ensureBackupEngineStarted();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  return (
    <html lang="fr">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: buildThemeBootstrapScript(),
          }}
        />
      </head>
      <body>
        <ThemeProvider />
        <AppFrame sessionRole={session?.role ?? null}>{children}</AppFrame>
      </body>
    </html>
  );
}
