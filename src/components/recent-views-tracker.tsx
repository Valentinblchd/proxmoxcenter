"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { rememberRecentView } from "@/lib/ui/recent-views";

const EXCLUDED_PATHS = new Set(["/login", "/unauthorized", "/forbidden"]);

export default function RecentViewsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || EXCLUDED_PATHS.has(pathname)) return;

    const query = searchParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    const timer = window.setTimeout(() => {
      const rawTitle = document.title.replace(/\s*\|\s*ProxmoxCenter$/i, "").trim();
      const title = rawTitle.length > 0 ? rawTitle : href;
      rememberRecentView({ href, title });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [pathname, searchParams]);

  return null;
}
