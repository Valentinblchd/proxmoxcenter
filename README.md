# ProxCenter

Interface web Proxmox orientée exploitation: inventaire, sauvegardes local/cloud, sécurité, provisioning, console, PBS optionnel.

## Développement local

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

L'application ne dépend pas d'un `.env` pour la configuration fonctionnelle courante. Les connexions Proxmox, PBS, auth locale et cibles cloud sont stockées par l'interface dans `data/`.

## Déploiement cible Linux x86_64

Installation one-liner prévue:

```bash
curl -fsSL https://proxmoxcenter/install | sudo bash
```

Dans le dépôt:

- `/Users/val/Documents/Dev/ProxCenter/src/app/install/route.ts`
- `/Users/val/Documents/Dev/ProxCenter/src/lib/install/bootstrap-template.ts`
- `/Users/val/Documents/Dev/ProxCenter/public/install-assets/docker-compose.yml`

Comportement du script:

- vérifie Linux `x86_64`
- installe Docker + Compose si absents
- déploie ProxmoxCenter dans `/opt/proxmoxcenter`
- persiste les données dans `/opt/proxmoxcenter/data`
- démarre le conteneur et attend `/api/health`
- ajoute les helpers:
  - `proxmoxcenter-status`
  - `proxmoxcenter-logs`
  - `proxmoxcenter-update`

Variables de déploiement possibles au lancement du script:

- `PROXMOXCENTER_INSTALL_DIR`
- `PROXMOXCENTER_DATA_DIR`
- `PROXMOXCENTER_PORT`
- `PROXMOXCENTER_IMAGE`
- `PROXMOXCENTER_INSTALL_BASE_URL`

## Conteneur

Le conteneur de prod embarque:

- Next.js standalone
- `proxmox-backup-client`
- persistance des fichiers runtime dans `/app/data`

En local sur Mac Apple Silicon, `docker-compose.yml` force `linux/amd64` pour rester aligné avec la cible Proxmox `x86_64`.
