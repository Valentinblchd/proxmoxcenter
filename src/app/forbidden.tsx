import Link from "next/link";
import ErrorStateScreen from "@/components/error-state-screen";

export default function Forbidden() {
  return (
    <ErrorStateScreen
      eyebrow="Erreur 403"
      code="403"
      title="Accès refusé"
      description="Tu es bien connecté, mais ton rôle courant n’a pas le droit d’ouvrir cette page ou cette action."
      diagnostics={[
        { label: "Statut", value: "Accès bloqué", tone: "bad" },
        { label: "Cause probable", value: "Droits insuffisants" },
        { label: "Zone utile", value: "Sécurité / sessions" },
      ]}
      actions={
        <>
          <Link href="/" className="action-btn primary">
            Retour accueil
          </Link>
          <Link href="/security" className="action-btn">
            Ouvrir sécurité
          </Link>
        </>
      }
    />
  );
}
