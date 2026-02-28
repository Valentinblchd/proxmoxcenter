import type { Metadata } from "next";
import AppFrame from "@/components/app-frame";
import { ensureBackupEngineStarted } from "@/lib/backups/engine";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProxCenter",
  description: "Dashboard Proxmox personnel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  ensureBackupEngineStarted();

  return (
    <html lang="fr">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
