# Cloud OAuth Broker

Ce mode sert à obtenir l'expérience voulue:

- l'instance self-hosted ne demande aucun `client_id`
- l'utilisateur clique `Connecter OneDrive` ou `Connecter Google Drive`
- la page officielle Microsoft ou Google s'ouvre
- le broker `ProxmoxCenter` porte les credentials OAuth

## 1. Ce qu'il faut fournir

Pour finir un test réel, il me faut ces éléments:

- Google Drive:
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_ID`
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_SECRET`
- OneDrive:
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_ID`
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_SECRET` si utilisé
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_AUTHORITY=consumers`
- Sécurité broker:
  - `PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS`
    - liste séparée par virgules, espaces ou retours ligne
    - contient uniquement les origins des instances ProxmoxCenter autorisées à recevoir le refresh token

Je ne peux pas créer ces credentials à ta place sans accès à tes comptes Google/Microsoft.

## 2. Redirect URI à enregistrer

### Test local broker

- OneDrive:
  - `http://localhost:3100/api/cloud-broker/oauth/onedrive/callback`
- Google Drive:
  - `http://localhost:3100/api/cloud-broker/oauth/gdrive/callback`

### Broker public

- OneDrive:
  - `https://ton-domaine-broker/api/cloud-broker/oauth/onedrive/callback`
- Google Drive:
  - `https://ton-domaine-broker/api/cloud-broker/oauth/gdrive/callback`

## 3. Test local complet

Exporter les credentials dans le shell, puis lancer:

```bash
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_ID="..."
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_SECRET="..."
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_AUTHORITY="consumers"
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_ID="..."
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_SECRET="..."
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS="http://localhost:3000"

docker compose -f docker-compose.yml -f docker-compose.oauth-broker.yml up -d --build
```

Résultat attendu:

- app self-hosted: `http://localhost:3000`
- broker central: `http://localhost:3100`

L'app locale pointera automatiquement vers le broker.

## 4. Déploiement public du broker

Le broker public peut tourner avec la même image que l'app.

Variables minimales:

```bash
PROXMOXCENTER_PUBLIC_ORIGIN=https://ton-domaine-broker
PROXMOXCENTER_CLOUD_OAUTH_MODE=local
PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_ID=...
PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_SECRET=...
PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_AUTHORITY=consumers
PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_ID=...
PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_SECRET=...
PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS=https://proxmox-a.exemple.fr,https://proxmox-b.exemple.fr
```

Puis, sur les instances self-hosted:

```bash
PROXMOXCENTER_CLOUD_OAUTH_MODE=central
PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN=https://ton-domaine-broker
```

## 5. Point sécurité important

Le broker central refuse maintenant toute origin cible non présente dans
`PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS`.

Sans cette allowlist:

- le broker ne démarre plus le flow OAuth,
- la route répond `503`,
- cela évite qu’un broker public serve de relais OAuth ouvert vers un domaine tiers.
