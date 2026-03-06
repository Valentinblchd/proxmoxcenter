"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import AiChatWidget from "@/components/ai-chat-widget";
import LiveSyncAlerts from "@/components/live-sync-alerts";
import SidebarNav from "@/components/sidebar-nav";
import type { RuntimeAuthUserRole } from "@/lib/auth/rbac";

export default function AppFrame({
  children,
  sessionRole,
}: Readonly<{
  children: React.ReactNode;
  sessionRole: RuntimeAuthUserRole | null;
}>) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isLoginRoute = pathname === "/login";

  if (isLoginRoute) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <Suspense fallback={null}>
        <SidebarNav
          sessionRole={sessionRole}
          mobileOpen={mobileMenuOpen}
          onRequestToggle={() => setMobileMenuOpen((current) => !current)}
          onRequestClose={() => setMobileMenuOpen(false)}
        />
      </Suspense>
      {mobileMenuOpen ? (
        <button
          type="button"
          className="mobile-menu-backdrop"
          aria-label="Fermer le menu"
          onClick={() => setMobileMenuOpen(false)}
          tabIndex={-1}
        />
      ) : null}
      <>
        {children}
        <LiveSyncAlerts />
        <AiChatWidget sessionRole={sessionRole} />
      </>
    </div>
  );
}
