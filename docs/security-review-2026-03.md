# Revue sécurité et UX

Date : 6 mars 2026

## Correctifs appliqués

### 1. Bypass de privilèges sur les routes backup/cloud/PBS

Avant correction, plusieurs routes POST sensibles acceptaient une session authentifiée sans exiger `operate`.

Corrigé :

- `src/app/api/backups/cloud-browser/route.ts`
- `src/app/api/backups/cloud-restore/route.ts`
- `src/app/api/pbs/browser/route.ts`
- `src/app/api/backups/oauth/gdrive/start/route.ts`
- `src/app/api/backups/oauth/onedrive/start/route.ts`

Effet :

- un compte `reader` ne peut plus lister les objets cloud, préparer des téléchargements déchiffrés, explorer PBS ni lancer un flow OAuth cloud.

### 2. Bypass TLS global via la config Proxmox

Avant correction, le mode TLS `insecure` de Proxmox modifiait `NODE_TLS_REJECT_UNAUTHORIZED` au niveau du process, ce qui pouvait affaiblir d’autres appels HTTPS de l’application.

Corrigé :

- `src/lib/proxmox/config.ts`
- `src/lib/proxmox/client.ts`
- `src/app/api/proxmox/[...path]/route.ts`

Effet :

- le relâchement TLS est maintenant borné au dispatcher `undici` utilisé pour Proxmox.

### 3. Robustesse OAuth cloud

Avant correction, les états OAuth vivaient uniquement en mémoire.

Corrigé :

- `src/lib/backups/oauth-state-store.ts`
- `src/lib/backups/google-oauth.ts`
- `src/lib/backups/onedrive-oauth.ts`
- `src/lib/backups/cloud-oauth-broker.ts`

Effet :

- un redémarrage applicatif pendant le flow OAuth n’invalide plus systématiquement l’échange,
- les états restent scellés localement avec `secret-box`.

### 4. UX lecture seule sur la page sauvegardes

Avant correction, plusieurs actions restaient visuellement disponibles malgré un compte `reader`.

Corrigé :

- `src/components/backup-planner-panel.tsx`
- `src/app/globals.css`

Effet :

- bannière lecture seule globale,
- formulaires backup désactivés,
- boutons sensibles verrouillés côté UI en plus du serveur.

### 5. Broker OAuth central utilisable comme relais ouvert

Avant correction, les routes publiques suivantes acceptaient n’importe quelle `origin` bien formée comme cible de retour:

- `src/app/api/cloud-broker/oauth/gdrive/start/route.ts`
- `src/app/api/cloud-broker/oauth/onedrive/start/route.ts`

Cause:

- `src/lib/backups/cloud-oauth-broker.ts` normalisait l’origin mais ne l’autorisait pas contre une allowlist.

Impact:

- un broker OAuth public pouvait servir de relais pour renvoyer un refresh token vers un domaine tiers contrôlé par un attaquant.

Corrigé :

- ajout de `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS`
- rejet `503` si l’allowlist n’est pas configurée
- rejet `403` si l’origin cible n’est pas autorisée

Effet :

- le broker central ne peut plus être exposé publiquement comme open broker OAuth.

## Vérifications effectuées

- `npm run typecheck` : OK
- build Docker local : OK
- routes sensibles testées en live :
  - `reader` => `403` sur cloud browser / cloud restore / PBS POST / OAuth start
  - `operator` => plus de `403`, réponses fonctionnelles attendues (`404` cible absente, `400` config manquante)
- pages HTML testées en live :
  - `/inventory`
  - `/backups`
  - `/observability`
  - `/settings?tab=proxmox`
  - résultat : plus d’`Application error`
- passe Chromium locale :
  - login admin/reader OK
  - captures sur inventaire et sauvegardes OK
  - état lecture seule visible sur sauvegardes

## Limites résiduelles

- la validation réelle des providers cloud dépend toujours d’identifiants OAuth valides et d’un accès réseau fournisseur,
- la validation PBS directe dépend de la présence du tooling `proxmox-backup-client` et d’une config PBS runtime,
- le lint du dépôt reste anormalement bloqué dans cet environnement ; il n’est donc pas certifié ici.
