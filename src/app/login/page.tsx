import type { Metadata } from "next";
import BrandLogo from "@/components/brand-logo";
import FirstAccountBootstrapForm from "@/components/first-account-bootstrap-form";
import { ensureBootstrapCode, getBootstrapCodePath } from "@/lib/auth/bootstrap-code";
import { isLdapSecondaryAuthEnabled } from "@/lib/auth/ldap";
import { getAuthStatus, sanitizeNextPath } from "@/lib/auth/session";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readMaybeArray(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function readSearchParams(
  searchParams: LoginPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!searchParams) return {};
  return await searchParams;
}

function getErrorMessage(errorCode: string) {
  switch (errorCode) {
    case "invalid":
      return "Identifiants invalides.";
    case "disabled":
      return "L’authentification n’est pas encore configurée.";
    case "misconfigured":
      return "La configuration d’authentification est incomplète ou invalide.";
    case "csrf":
      return "Requête bloquée (origine invalide). Recharge la page et réessaie.";
    case "rate_limited":
      return "Trop de tentatives. Attends un peu avant de réessayer.";
    case "ldap_disabled":
      return "Connexion LDAP indisponible: LDAP n’est pas activé.";
    default:
      return "";
  }
}

export const metadata: Metadata = {
  title: "Connexion | ProxmoxCenter",
  description: "Authentification locale ProxmoxCenter",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await readSearchParams(searchParams);
  const nextPath = sanitizeNextPath(readMaybeArray(params.next));
  const errorCode = readMaybeArray(params.error);
  const errorMessage = getErrorMessage(errorCode);
  const methodRaw = readMaybeArray(params.method).toLowerCase();
  const selectedMethod = methodRaw === "ldap" ? "ldap" : "local";
  const authStatus = getAuthStatus();
  const isFirstSetup = !authStatus.active;
  const ldapSecondaryEnabled = isLdapSecondaryAuthEnabled();
  const bootstrapCodePath = getBootstrapCodePath();

  if (isFirstSetup) {
    ensureBootstrapCode();
  }

  return (
    <main className="login-shell">
      <div className="login-glow" aria-hidden="true" />

      <section className="login-card">
        <div className="login-brand">
          <div className="brand" aria-hidden="true">
            <span className="brand-logo-wrap">
              <BrandLogo className="brand-logo" />
            </span>
          </div>
          <div>
            <p className="eyebrow">ProxmoxCenter</p>
            <h1>{isFirstSetup ? "Créer le compte admin" : "Connexion"}</h1>
          </div>
        </div>

        {errorMessage ? <div className="login-state error-box">{errorMessage}</div> : null}

        {isFirstSetup ? (
          <FirstAccountBootstrapForm nextPath={nextPath} bootstrapCodePath={bootstrapCodePath} />
        ) : (
          <form method="post" action="/api/auth/login" className="login-form">
            <input type="hidden" name="next" value={nextPath} />
            {ldapSecondaryEnabled ? (
              <label className="field">
                <span className="field-label">Méthode de connexion</span>
                <select
                  className="field-input"
                  name="authMethod"
                  defaultValue={selectedMethod}
                >
                  <option value="local">Local</option>
                  <option value="ldap">LDAP</option>
                </select>
              </label>
            ) : (
              <>
                <input type="hidden" name="authMethod" value="local" />
                <label className="field">
                  <span className="field-label">Méthode de connexion</span>
                  <input className="field-input" type="text" value="Local" readOnly />
                </label>
              </>
            )}

            <label className="field">
              <span className="field-label">Utilisateur</span>
              <input
                className="field-input"
                type="text"
                name="username"
                placeholder="admin"
                autoComplete="username"
                required
              />
            </label>

            <label className="field">
              <span className="field-label">Mot de passe</span>
              <input
                className="field-input"
                type="password"
                name="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </label>

            <button className="login-submit" type="submit">
              Se connecter
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
