"use client";

import Link from "next/link";
import { useEffect } from "react";
import ErrorStateScreen from "@/components/error-state-screen";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="fr" data-theme="current">
      <body>
        <ErrorStateScreen
          standalone
          eyebrow="Erreur critique"
          code="500"
          title="ProxCenter a dû s’arrêter ici"
          description="Une erreur plus large a empêché l’application de finir le rendu normalement."
          detail={
            error.digest ? (
              <div className="hint-box">
                <p className="muted">
                  Identifiant incident: <strong>{error.digest}</strong>
                </p>
              </div>
            ) : null
          }
          diagnostics={[
            { label: "Portée", value: "Globale", tone: "bad" },
            { label: "Action conseillée", value: "Recharger l’application" },
            { label: "Secours", value: "Retour accueil" },
          ]}
          actions={
            <>
              <button type="button" className="action-btn primary" onClick={() => reset()}>
                Réessayer
              </button>
              <Link href="/" className="action-btn">
                Retour accueil
              </Link>
              <Link href="/settings?tab=proxmox" className="action-btn">
                Vérifier Proxmox
              </Link>
            </>
          }
        />
      </body>
    </html>
  );
}
