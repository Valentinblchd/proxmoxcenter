"use client";

import Link from "next/link";
import { useEffect } from "react";
import ErrorStateScreen from "@/components/error-state-screen";

export default function AppError({
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
    <ErrorStateScreen
      eyebrow="Erreur applicative"
      code="500"
      title="Le chargement a échoué"
      description="L’interface a rencontré une erreur inattendue pendant le rendu de cette page."
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
        { label: "Statut", value: "Erreur serveur / rendu", tone: "bad" },
        { label: "Récupération", value: "Relancer la page" },
        { label: "Fallback", value: "Accueil ou inventaire" },
      ]}
      actions={
        <>
          <button type="button" className="action-btn primary" onClick={() => reset()}>
            Réessayer
          </button>
          <Link href="/" className="action-btn">
            Retour accueil
          </Link>
          <Link href="/inventory" className="action-btn">
            Ouvrir inventaire
          </Link>
          <Link href="/security?tab=logs" className="action-btn">
            Ouvrir les journaux
          </Link>
        </>
      }
    />
  );
}
