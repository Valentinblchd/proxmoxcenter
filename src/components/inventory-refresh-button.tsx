"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

export default function InventoryRefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <button
      type="button"
      className="inventory-ghost-btn"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        startTransition(() => {
          router.refresh();
          setTimeout(() => setRefreshing(false), 700);
        });
      }}
    >
      {refreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}
