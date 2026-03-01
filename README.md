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
