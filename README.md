# ProxmoxCenter

Interface web Proxmox orientée exploitation: inventaire, sauvegardes local/cloud, sécurité, provisioning, console, PBS optionnel.

## Développement local

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

L'application ne dépend pas d'un `.env` pour la configuration fonctionnelle courante. Les connexions Proxmox, PBS, auth locale et cibles cloud sont stockées par l'interface dans `data/`.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/Valentinblchd/proxmoxcenter/main/install.sh | sudo bash
```

Configuration ensuite via l'interface:

- premier compte local
- connexion Proxmox
- sauvegardes local/cloud
- PBS si utilisé

## Cloud OAuth

Par défaut, l'instance self-hosted fonctionne en mode local:

- `PROXMOXCENTER_CLOUD_OAUTH_MODE=local`
- configuration OneDrive / Google Drive dans `Paramètres -> Connexions`

Le mode broker central reste disponible en option:

- `PROXMOXCENTER_CLOUD_OAUTH_MODE=central`
- `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN=https://ton-service-proxmoxcenter`

Guide broker:

- `/Users/val/Documents/Dev/ProxCenter/docs/cloud-oauth-broker.md`
