"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import AiChatWidget from "@/components/ai-chat-widget";
import SidebarNav from "@/components/sidebar-nav";

export default function AppFrame({
  children,
}: Readonly<{
  children: React.ReactNode;
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
        <AiChatWidget />
      </>
    </div>
  );
}
