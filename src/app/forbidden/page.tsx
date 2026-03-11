import Link from "next/link";
import ErrorStateScreen from "@/components/error-state-screen";
import { sanitizeNextPath } from "@/lib/auth/session";

type ForbiddenPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForbiddenPage({ searchParams }: ForbiddenPageProps) {
  const params = searchParams ? await searchParams : {};
  const fromPath = sanitizeNextPath(readString(params.from));

  return (
    <ErrorStateScreen
      eyebrow="Erreur 403"
      code="403"
      title="Accès refusé"
      description={
        fromPath && fromPath !== "/"
          ? `Tu es bien connecté, mais ton rôle courant n’a pas le droit d’ouvrir ${fromPath}.`
          : "Tu es bien connecté, mais ton rôle courant n’a pas le droit d’ouvrir cette page ou cette action."
      }
      diagnostics={[
        { label: "Statut", value: "Accès bloqué", tone: "bad" },
        { label: "Cause probable", value: "Droits insuffisants" },
        { label: "Zone utile", value: "Sécurité / sessions" },
        ...(fromPath && fromPath !== "/" ? [{ label: "Page demandée", value: fromPath }] : []),
      ]}
      actions={
        <>
          <Link href="/" className="action-btn primary">
            Retour accueil
          </Link>
          {fromPath && fromPath !== "/" ? (
            <Link href={fromPath} className="action-btn">
              Réessayer la page
            </Link>
          ) : null}
          <Link href="/security" className="action-btn">
            Ouvrir sécurité
          </Link>
        </>
      }
    />
  );
}
