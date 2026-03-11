import Link from "next/link";
import ErrorStateScreen from "@/components/error-state-screen";
import { sanitizeNextPath } from "@/lib/auth/session";

type UnauthorizedPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UnauthorizedPage({ searchParams }: UnauthorizedPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = sanitizeNextPath(readString(params.next));

  return (
    <ErrorStateScreen
      eyebrow="Erreur 401"
      code="401"
      title="Authentification requise"
      description={
        nextPath && nextPath !== "/"
          ? `Cette page ou cette action demande une session valide avant d’ouvrir ${nextPath}.`
          : "Cette page ou cette action demande une session valide. Connecte-toi puis réessaie."
      }
      diagnostics={[
        { label: "Statut", value: "Session requise", tone: "warn" },
        { label: "Cause probable", value: "Session expirée ou absente" },
        { label: "Suite", value: "Reconnexion locale ou LDAP" },
        ...(nextPath && nextPath !== "/" ? [{ label: "Page demandée", value: nextPath }] : []),
      ]}
      actions={
        <>
          <Link
            href={nextPath && nextPath !== "/" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
            className="action-btn primary"
          >
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
