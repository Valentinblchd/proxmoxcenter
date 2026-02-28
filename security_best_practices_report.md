# Security Best Practices Report - ProxCenter

## Executive Summary

Passe securite ciblee sur l'authentification locale, le bootstrap initial et les endpoints de mutation (Proxmox / actions VM/CT).

Resultat: les protections contre les bypass UI simples etaient deja bonnes via `proxy`, mais il manquait des protections anti-bruteforce et anti-CSRF sur plusieurs endpoints sensibles. Cette passe ajoute des mitigations concretes (rate-limit login/bootstrap, checks d'origine same-origin, logout POST-only, hash password PBKDF2 pour les nouveaux mots de passe).

Risque residuel principal: le bootstrap du **premier compte** reste publiquement atteignable avant initialisation (`/api/setup/auth`) par design. Si l'instance est exposee avant le premier setup, un attaquant peut revendiquer le premier compte admin.

## Fixed Findings (Applied During This Pass)

### F-001 - High - Brute force login possible (no rate limiting)
- Rule ID: NEXT-AUTH-ANTIABUSE-001 (anti-abuse/rate-limit best practice)
- Location: `src/app/api/auth/login/route.ts:15`, `src/app/api/auth/login/route.ts:58`
- Evidence (before fix): `POST /api/auth/login` verified credentials without per-IP / per-user attempt throttling.
- Impact: online brute-force / credential stuffing on the local admin account.
- Fix applied:
  - Added in-memory rate limiting helper (`src/lib/security/rate-limit.ts:58`)
  - Enforced per-IP and per-IP+username limits in login route (`src/app/api/auth/login/route.ts:58`)
  - Reset per-user bucket on successful login (`src/app/api/auth/login/route.ts:80`)
- Mitigation note: current limiter is process-memory only (see residual finding R-003).

### F-002 - High - CSRF exposure on state-changing endpoints (including logout)
- Rule ID: NEXT-CSRF-001
- Location:
  - `src/app/api/auth/logout/route.ts:21`
  - `src/app/api/setup/auth/route.ts:102`
  - `src/app/api/setup/proxmox/route.ts:116`
  - `src/app/api/workloads/action/route.ts:31`
  - `src/app/api/proxmox/[...path]/route.ts:63`
- Evidence (before fix): mutations accepted cookie-authenticated requests without validating request origin.
- Impact: cross-site requests could trigger logout or privileged actions under some browser/session scenarios.
- Fix applied:
  - Added same-origin request guard (`src/lib/security/request-guards.ts:40`)
  - Enforced on mutating routes listed above
  - `GET /api/auth/logout` changed to `405` (`src/app/api/auth/logout/route.ts:21`), keeping logout on POST only.
- Runtime validation: `POST` mutations without `Origin/Referer` now return `403`; `POST /api/auth/logout` with valid `Origin` still works.

### F-003 - Medium - Weak password hashing for newly stored admin credentials (single SHA-256)
- Rule ID: NEXT-AUTH-CREDENTIAL-STORAGE-001
- Location: `src/lib/auth/session.ts:119`
- Evidence (before fix): `hashPasswordWithSalt()` used a single SHA-256 digest of `salt:password`.
- Impact: if `data/app-auth.json` is exfiltrated, offline cracking cost is much lower than a KDF-based hash.
- Fix applied:
  - New password writes now use PBKDF2-SHA256 with 310,000 iterations (`src/lib/auth/session.ts:94`, `src/lib/auth/session.ts:119`)
  - Backward-compatible verification for legacy hashes retained (`src/lib/auth/session.ts:195` / fallback at `:201`).

### F-004 - Medium - Bootstrap/setup endpoints had no anti-abuse throttling
- Rule ID: NEXT-ANTIABUSE-SETUP-001
- Location:
  - `src/app/api/setup/auth/route.ts:21`
  - `src/app/api/setup/proxmox/route.ts:20`
- Evidence (before fix): repeated POSTs to bootstrap/setup could be spammed without throttling.
- Impact: easier probing/abuse and unnecessary pressure on Proxmox connectivity tests.
- Fix applied:
  - Added per-IP rate limit on `POST /api/setup/auth` and `POST /api/setup/proxmox`.

## Residual Findings (Not Fully Solved Yet)

### R-001 - High - First-account bootstrap takeover risk before initialization (by design)
- Rule ID: NEXT-BOOTSTRAP-TRUST-001
- Location: `src/proxy.ts:45`, `src/proxy.ts:48`, `src/app/api/setup/auth/route.ts:102`
- Evidence:
  - When auth is not configured, proxy explicitly allows unauthenticated access to `/api/setup/auth`.
  - `POST /api/setup/auth` can create the initial admin account.
- Impact (one sentence): if the instance is exposed before the owner completes initial setup, a network attacker can create the first admin account and take control.
- Fix options:
  - Add a one-time bootstrap secret/token shown only in server logs/console and required by first account creation.
  - Restrict first setup to localhost/private network (weaker than token, but reduces exposure).
  - Ship the app behind temporary network ACL/VPN and complete setup before exposure.

### R-002 - Medium - Legacy SHA-256 hashes remain valid until password rotation
- Rule ID: NEXT-AUTH-MIGRATION-001
- Location: `src/lib/auth/session.ts:201`
- Evidence: fallback path still verifies old single-round SHA-256 hashes for backward compatibility.
- Impact: any pre-existing `app-auth.json` generated before this pass still uses weaker offline resistance until password reset.
- Fix options:
  - Force password rotation on next login if legacy hash is detected.
  - Auto-migrate hash to PBKDF2 after successful login (careful with write path and race handling).

### R-003 - Low/Medium - Rate limiting is memory-local only
- Rule ID: NEXT-ANTIABUSE-DISTRIBUTED-001
- Location: `src/lib/security/rate-limit.ts:29`
- Evidence: limiter state is stored in `globalThis` map.
- Impact: counters reset on restart and do not coordinate across multiple instances/containers.
- Fix options:
  - Move counters to Redis or another shared store for production/multi-instance deployments.
  - Keep current limiter for homelab/single-container use (acceptable MVP).

## Runtime Checks Performed (This Pass)

- `GET /api/auth/logout` returns `405` (POST-only)
- `POST /api/auth/login` without `Origin` returns redirect with `error=csrf`
- `POST /api/setup/auth` without `Origin` returns `403`
- `POST /api/setup/proxmox` without `Origin` (authenticated) returns `403`
- `POST /api/workloads/action` without `Origin` (authenticated) returns `403`
- `POST /api/proxmox/...` without `Origin` (authenticated) returns `403`
- `POST /api/setup/auth` with invalid password policy is rejected server-side

## Notes

- Login brute-force rate-limit behavior is implemented in code and validated at code level; repeated high-frequency `curl` loop testing from this execution environment was unreliable (connection failures unrelated to app logic during rapid loops).
- The app was returned to first-run state after testing by removing `data/app-auth.json`.
