import Link from "next/link";
import ErrorStateScreen from "@/components/error-state-screen";

export default function Unauthorized() {
  return (
    <ErrorStateScreen
      eyebrow="Erreur 401"
      code="401"
      title="Authentification requise"
      description="Cette page ou cette action demande une session valide. Connecte-toi puis réessaie."
      diagnostics={[
        { label: "Statut", value: "Session requise", tone: "warn" },
        { label: "Cause probable", value: "Session expirée ou absente" },
        { label: "Suite", value: "Reconnexion locale ou LDAP" },
      ]}
      actions={
        <>
          <Link href="/login" className="action-btn primary">
            Ouvrir login
          </Link>
          <Link href="/" className="action-btn">
            Retour accueil
          </Link>
        </>
      }
    />
  );
}
