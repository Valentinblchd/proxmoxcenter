import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import AppFrame from "@/components/app-frame";
import ThemeProvider from "@/components/theme-provider";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { ensureBackupEngineStarted } from "@/lib/backups/engine";
import { ensureGreenItSamplerStarted } from "@/lib/greenit/sampler";
import { CSP_NONCE_HEADER, readCspNonce } from "@/lib/security/csp";
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
  ensureGreenItSamplerStarted();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const nonce = readCspNonce(headerStore.get(CSP_NONCE_HEADER));
  const session = token ? await verifySessionToken(token) : null;

  return (
    <html lang="fr">
      <head>
        <script
          nonce={nonce ?? undefined}
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
