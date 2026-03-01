# ProxmoxCenter

Interface web Proxmox orientée exploitation : inventaire, sauvegardes local/cloud, sécurité, provisioning, console, PBS optionnel.

## Fonctionnalités

- **Inventaire** — liste et détails des VMs/LXCs sur tous tes nœuds Proxmox
- **Console** — accès console VMs et conteneurs directement depuis le navigateur (noVNC / xterm)
- **Sauvegardes** — gestion des sauvegardes locales et vers le cloud (Google Drive, OneDrive) avec PBS optionnel
- **Sécurité** — tableau de bord sécurité, alertes et bonnes pratiques
- **Provisioning** — création et configuration de VMs/LXCs
- **Observabilité** — métriques et état des ressources
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

### Variables d'environnement optionnelles

Passe-les en préfixe de la commande d'installation :

| Variable | Défaut | Description |
|---|---|---|
| `PROXMOXCENTER_PORT` | `3000` | Port d'écoute local |
| `PROXMOXCENTER_INSTALL_DIR` | `/opt/proxmoxcenter` | Répertoire d'installation |
| `PROXMOXCENTER_DATA_DIR` | `<INSTALL_DIR>/data` | Répertoire des données persistées |
| `PROXMOXCENTER_PUBLIC_ORIGIN` | _(vide)_ | URL publique de l'instance, ex. `https://proxmox.exemple.fr` |
| `PROXMOXCENTER_CLOUD_OAUTH_MODE` | `local` | `local` ou `central` (broker OAuth) |
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

Les connexions et données sont stockées dans `<INSTALL_DIR>/data/`.

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

## Développement local

```bash
npm install
npm run dev
```

Puis ouvre `http://localhost:3000`.

L'application ne dépend pas d'un `.env` pour la configuration fonctionnelle courante. Les connexions Proxmox, PBS, auth locale et cibles cloud sont stockées par l'interface dans `data/`.
