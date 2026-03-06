import ErrorStateScreen from "@/components/error-state-screen";

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
    />
  );
}
