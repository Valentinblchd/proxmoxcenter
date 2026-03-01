FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl gpg; \
  mkdir -p /usr/share/keyrings; \
  if curl -fsSL https://download.proxmox.com/debian/proxmox-release-bookworm.gpg -o /tmp/proxmox-release-bookworm.gpg; then \
    if gpg --batch --yes --dearmor -o /usr/share/keyrings/proxmox-release-bookworm.gpg /tmp/proxmox-release-bookworm.gpg; then \
      echo "deb [signed-by=/usr/share/keyrings/proxmox-release-bookworm.gpg] http://download.proxmox.com/debian/pbs-client bookworm main" > /etc/apt/sources.list.d/proxmox-pbs-client.list; \
      apt-get update || true; \
      apt-get install -y --no-install-recommends proxmox-backup-client || true; \
    fi; \
  fi; \
  rm -rf /var/lib/apt/lists/* /tmp/proxmox-release-bookworm.gpg

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
