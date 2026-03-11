import ErrorStateScreen from "@/components/error-state-screen";
import Link from "next/link";

export default function NotFound() {
  return (
    <ErrorStateScreen
      eyebrow="Erreur 404"
      code="404"
      title="Page introuvable"
      description="La page demandée n’existe pas, a été déplacée ou l’URL n’est pas correcte."
      diagnostics={[
        { label: "Statut", value: "Introuvable", tone: "warn" },
        { label: "Impact", value: "Navigation interrompue" },
        { label: "Suite", value: "Repartir depuis un menu connu" },
      ]}
      actions={
        <>
          <Link href="/" className="action-btn primary">
            Retour accueil
          </Link>
          <Link href="/inventory" className="action-btn">
            Ouvrir inventaire
          </Link>
          <Link href="/observability" className="action-btn">
            Ouvrir observabilité
          </Link>
        </>
      }
    />
  );
}
