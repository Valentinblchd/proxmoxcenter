import Link from "next/link";

export default function PlatformStateAlerts({
  live,
  warnings,
  settingsHref = "/settings?tab=proxmox",
}: {
  live: boolean;
  warnings: string[];
  settingsHref?: string;
}) {
  const topWarnings = warnings.slice(0, 2);
  if (live && topWarnings.length === 0) {
    return null;
  }

  return (
    <div className="backup-alert-stack page-alert-stack">
      {!live ? (
        <article className="backup-alert warn">
          <strong>Connexion Proxmox indisponible</strong>
          <p>Les données affichées peuvent être incomplètes ou figées tant que l’API Proxmox ne répond pas.</p>
          <div className="quick-actions">
            <Link href={settingsHref} className="action-btn">
              Vérifier la connexion
            </Link>
          </div>
        </article>
      ) : null}

      {topWarnings.map((warning, index) => (
        <article key={`${warning}-${index}`} className="backup-alert error">
          <strong>Alerte plateforme</strong>
          <p>{warning}</p>
        </article>
      ))}
    </div>
  );
}
