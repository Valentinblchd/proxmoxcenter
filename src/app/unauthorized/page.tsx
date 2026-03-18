import Link from "next/link";
import BrandLogo from "@/components/brand-logo";
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
  const loginHref =
    nextPath && nextPath !== "/" ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";

  return (
    <main className="login-shell">
      <div className="login-glow" aria-hidden="true" />

      <section className="login-card login-card-compact">
        <div className="login-brand">
          <div className="brand" aria-hidden="true">
            <span className="brand-logo-wrap">
              <BrandLogo className="brand-logo" />
            </span>
          </div>
          <div>
            <p className="eyebrow">Session</p>
            <h1>Vous avez été déconnecté.</h1>
          </div>
        </div>

        <div className="quick-actions">
          <Link href={loginHref} className="action-btn primary">
            Retour au login
          </Link>
        </div>
      </section>
    </main>
  );
}
