# ProxmoxCenter

Interface web Proxmox orientée exploitation : inventaire, sauvegardes local/cloud, sécurité, provisioning, console, PBS optionnel.

## Fonctionnalités

- **Inventaire** — liste et détails des VMs/LXCs sur tous tes nœuds Proxmox
- **Console** — accès console VMs et conteneurs directement depuis le navigateur (noVNC / xterm)
- **Sauvegardes** — gestion des sauvegardes locales et vers le cloud (Google Drive, OneDrive) avec PBS optionnel
- **Sécurité** — tableau de bord sécurité, alertes et bonnes pratiques
- **Contrôle d’accès** — comptes locaux `reader`, `operator`, `admin` avec audit des actions
- **Provisioning** — création et configuration de VMs/LXCs
- **Observabilité** — métriques et état des ressources, avec sonde matérielle BMC / iLO Redfish en option
- **Opérations** — actions groupées sur les machines
- **Paramètres** — gestion des connexions Proxmox, PBS, cloud et des comptes locaux

## Prérequis

- Linux **x86_64** (Debian / Ubuntu / Proxmox VE recommandé)
- Docker et le plugin Compose sont installés **automatiquement** si absents

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/Valentinblchd/proxmoxcenter/main/install.sh | sudo bash
```

L'installateur :
1. Vérifie la plateforme et installe Docker si nécessaire
2. Crée le répertoire `/opt/proxmoxcenter` et y dépose un `docker-compose.yml`
3. Télécharge l'image depuis `ghcr.io/valentinblchd/proxmoxcenter:latest`
4. Démarre le conteneur et attend le healthcheck

### Taille du package

- Image Docker ProxmoxCenter actuelle: environ **392 MiB** en local (`linux/amd64`)
- La taille peut légèrement varier selon la version publiée et la plateforme cible

### Variables d'environnement optionnelles

Passe-les en préfixe de la commande d'installation :

| Variable | Défaut | Description |
|---|---|---|
| `PROXMOXCENTER_PORT` | `3000` | Port d'écoute local |
| `PROXMOXCENTER_INSTALL_DIR` | `/opt/proxmoxcenter` | Répertoire d'installation |
| `PROXMOXCENTER_DATA_DIR` | `<INSTALL_DIR>/data` | Répertoire des données persistées |
| `PROXMOXCENTER_PUBLIC_ORIGIN` | _(vide)_ | URL canonique de l'instance. Laisse vide en accès direct local IP/FQDN, renseigne-la derrière un reverse proxy ou en HTTPS public |
| `PROXMOXCENTER_TRUST_PROXY_HEADERS` | `0` | Fais confiance à `X-Forwarded-For` / `X-Real-IP` pour les rate limits et l’audit IP. Active-le uniquement derrière un reverse proxy que tu contrôles |
| `PROXMOXCENTER_CLOUD_OAUTH_MODE` | `local` | `local` ou `central` (broker OAuth) |
| `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS` | _(vide)_ | Obligatoire sur un broker OAuth public: liste d'origins autorisées à recevoir le refresh token |
| `PROXMOXCENTER_CLOUD_OAUTH_SECRETS_PATH` | `<INSTALL_DIR>/data/cloud-oauth-secrets.json` | Fichier local optionnel contenant les identifiants OAuth Google / Microsoft côté serveur, sans passer par l’UI |
| `PROXMOXCENTER_IMAGE` | `ghcr.io/valentinblchd/proxmoxcenter:latest` | Image Docker à utiliser |

Exemple :

```bash
PROXMOXCENTER_PORT=8080 PROXMOXCENTER_PUBLIC_ORIGIN=https://proxmox.exemple.fr \
  curl -fsSL https://raw.githubusercontent.com/Valentinblchd/proxmoxcenter/main/install.sh | sudo bash
```

## Configuration post-installation

Ouvre `http://<IP_DU_SERVEUR>:3000` dans ton navigateur, puis :

1. Crée le premier compte local
2. Ajoute la connexion Proxmox (hôte, port, token API)
3. Configure les sauvegardes local/cloud si nécessaire
4. Ajoute PBS si tu l'utilises
5. Si ton serveur expose un BMC/iLO Redfish, configure-le dans `Paramètres > Proxmox > Sonde serveur`

Les connexions et données sont stockées dans `<INSTALL_DIR>/data/`.

## Métriques matérielles serveur

Pour récupérer les métriques physiques du serveur hôte (températures, CPU, RAM, disques), ProxmoxCenter peut interroger un BMC compatible Redfish, par exemple HPE iLO.

Configuration :

1. Ouvre `Paramètres > Proxmox > Sonde serveur`
2. Renseigne l’IP ou le DNS du BMC/iLO
3. Renseigne le compte BMC/iLO
4. Laisse `HTTPS` + `TLS strict` si le certificat est valide
5. Lie éventuellement la sonde à un nœud Proxmox précis

Une fois configuré, l’onglet `Observabilité > Santé` affiche :

- température max / moyenne du serveur
- état global matériel
- état CPU
- état RAM
- état des disques physiques
- puissance instantanée et moyenne si le BMC expose un power meter Redfish

Si ton iLO utilise un certificat autosigné, tu peux soit importer la CA personnalisée, soit passer temporairement en mode `TLS insecure`.

Si le power meter Redfish est disponible, GreenIT l’utilise automatiquement en priorité pour le calcul de consommation et de coût. Sinon, ProxmoxCenter retombe sur la puissance manuelle ou l’estimation Proxmox.

## Reverse Proxy

Si tu exposes ProxmoxCenter derrière un reverse proxy HTTPS :

- définis `PROXMOXCENTER_PUBLIC_ORIGIN=https://ton-fqdn`
- active `Secure cookie` dans `Sécurité > Sessions & accès`
- active `PROXMOXCENTER_TRUST_PROXY_HEADERS=1` si tu veux conserver les vraies IP clientes dans les rate limits et l’audit
- laisse le proxy transmettre `Host`, `X-Real-IP`, `X-Forwarded-For`
- autorise l’upgrade WebSocket pour la console

Exemple nginx minimal :

```nginx
server {
  listen 443 ssl http2;
  server_name proxmox.exemple.fr;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

En accès direct local sur IP ou FQDN de la machine, `PROXMOXCENTER_PUBLIC_ORIGIN` peut rester vide.

## Rôles et permissions

- **`reader`** — lecture seule sur l’inventaire, l’observabilité, les journaux et l’état global des sauvegardes
- **`operator`** — mêmes accès que `reader`, avec en plus les actions d’exploitation : runs manuels, restores, connexions cloud, PBS direct, provisioning et actions VM/CT
- **`admin`** — mêmes accès que `operator`, avec en plus les paramètres sensibles : proxy Proxmox, comptes locaux, UI auth et configuration système

En pratique :

- la navigation reste visible en lecture seule pour éviter les écrans vides,
- les routes sensibles `backup/cloud/PBS/OAuth` refusent côté serveur toute action sans le bon rôle,
- l’UI marque explicitement les vues lecture seule sur les écrans d’exploitation.

## Sécurité et stockage local

Les données persistées vivent dans `<INSTALL_DIR>/data/` :

- `app-auth.json` — comptes locaux, rôles et secret de session
- `proxmox-connection.json` — connexion Proxmox runtime
- `cloud-oauth-apps.json` — clients OAuth cloud locaux
- `audit-log.json` — journal d’audit des connexions et actions sensibles
- `secret-box.key` — clé locale servant à chiffrer les secrets stockés
- `cloud-oauth-state.json` — états OAuth courts persistés pour survivre aux redémarrages

Notes sécurité :

- les cookies de session sont `HttpOnly` et `SameSite=Lax`,
- les mutations sensibles refusent maintenant les requêtes `same-site` qui ne sont pas du même origin exact,
- les secrets sensibles stockés par l’application sont chiffrés au repos,
- les flows OAuth cloud utilisent un `state` côté serveur et un retour popup contrôlé,
- un broker OAuth central public doit déclarer `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS`, sinon le flow est bloqué,
- les en-têtes `X-Forwarded-*` ne servent plus d’origin canonique implicite ; en reverse proxy/HTTPS public, renseigne `PROXMOXCENTER_PUBLIC_ORIGIN`,
- les IP clientes en `X-Forwarded-*` ne sont plus trustées par défaut pour éviter le bypass de rate limit par spoofing ; active `PROXMOXCENTER_TRUST_PROXY_HEADERS=1` uniquement si le proxy est de confiance,
- le mode TLS Proxmox `insecure` reste limité aux appels Proxmox et ne désactive plus la vérification TLS globale du process Node.js.

## Sauvegardes et permissions

La page `Sauvegardes` est organisée par cible, plans, historique, restauration et navigateur PBS.

- la création/modification de plans et de cibles cloud demande `operator` ou `admin`,
- la navigation cloud, l’extraction PBS et le restore cloud demandent `operator` ou `admin`,
- un compte `reader` peut consulter l’état global, mais pas lancer ni préparer une action destructive ou sensible.

## Commandes utiles

Après installation, ces scripts sont disponibles globalement :

```bash
proxmoxcenter-status   # état du conteneur + healthcheck
proxmoxcenter-logs     # logs en continu (tail 200)
proxmoxcenter-update   # mise à jour vers la dernière image
```

## Mise à jour

```bash
proxmoxcenter-update
```

Ou manuellement :

```bash
curl -fsSL https://raw.githubusercontent.com/Valentinblchd/proxmoxcenter/main/install.sh | sudo bash
```

## Cloud OAuth (avancé)

Pour connecter Google Drive ou OneDrive sans saisir de `client_id` dans chaque instance, un broker OAuth central peut être déployé. Voir [`docs/cloud-oauth-broker.md`](docs/cloud-oauth-broker.md).

Modes disponibles :

- **`local`** — chaque instance stocke son propre client OAuth et ses refresh tokens chiffrés
- **`central`** — un broker OAuth ProxmoxCenter centralise le flow popup et renvoie le refresh token à l’instance appelante

Le flow reste popup-based côté interface, avec état OAuth persisté localement pour supporter un redémarrage de l’application pendant l’échange.
En mode `central`, le broker public doit être borné avec `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS` pour ne pas servir de relais OAuth ouvert.

### Fichier local de secrets OAuth

Si tu veux que les utilisateurs n’aient qu’à cliquer sur `Se connecter avec Google` ou `Se connecter avec Microsoft`, tu peux déposer un fichier local côté serveur avec les identifiants OAuth de ton application.

Chemin par défaut :

```bash
/opt/proxmoxcenter/data/cloud-oauth-secrets.json
```

Format :

```json
{
  "onedrive": {
    "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "clientSecret": "microsoft-client-secret",
    "authority": "consumers",
    "secretExpiresAt": "2027-03-12"
  },
  "gdrive": {
    "clientId": "1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
    "clientSecret": "google-client-secret",
    "secretExpiresAt": "2027-03-12"
  }
}
```

Notes :

- ce fichier est lu automatiquement par l’application
- il surcharge la configuration OAuth saisie dans l’interface
- il reste local au serveur et n’est pas pushé dans git
- le chemin peut être changé avec `PROXMOXCENTER_CLOUD_OAUTH_SECRETS_PATH`
- mets-lui des permissions strictes, par exemple `chmod 600`
- `secretExpiresAt` est optionnel mais recommandé: l’interface remonte une alerte 30 jours avant expiration du secret client

Exemple :

```bash
sudo install -m 600 /dev/null /opt/proxmoxcenter/data/cloud-oauth-secrets.json
sudo editor /opt/proxmoxcenter/data/cloud-oauth-secrets.json
sudo docker compose -f /opt/proxmoxcenter/docker-compose.yml restart proxcenter
```

Une fois le fichier présent, les boutons OAuth Google / Microsoft peuvent être utilisés sans ressaisie des clés dans l’UI.

## Développement local

```bash
npm install
npm run dev
```

Puis ouvre `http://localhost:3000`.

L'application ne dépend pas d'un `.env` pour la configuration fonctionnelle courante. Les connexions Proxmox, PBS, auth locale et cibles cloud sont stockées par l'interface dans `data/`.

## Validation rapide

```bash
npm run typecheck
npm run test:redfish
npm run test:ui:smoke
```

Notes :

- `test:redfish` valide le parseur Redfish/HPE iLO sur des fixtures réelles
- `test:ui:smoke` couvre les routes UI principales et les pages d’erreur ; définis `PROXCENTER_SMOKE_USER` et `PROXCENTER_SMOKE_PASSWORD` pour activer aussi le smoke authentifié
