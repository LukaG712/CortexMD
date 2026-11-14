# CortexMD Proxmox Deployment & Operations Guide

## 1. Resource Profile & Hardware Fit

CortexMD is designed specifically for lightweight homelab hardware (**4 CPU cores, 8 GB RAM, ~100 GB SSD + large HDD storage**):

- **Modular Monolith:** Next.js 15 standalone server on **Node 24** with embedded `node:sqlite` (`DatabaseSync` WAL + FTS5) and in-process 384-dim semantic chunk vectors. Zero external vector databases, Redis instances, or heavy microservices required.
- **Container Footprint:** `docker-compose.yml` caps runtime usage to `2.0` vCPUs and `1024M` RAM (typical steady-state RAM usage ~120–250 MB).
- **Direct Markdown Truth:** Every note and attachment resides as plain `.md` and media files on persistent disk (`/data/vaults/<workspace-slug>/`). SQLite acts solely as a fast, rebuildable index (`cortex.db`).

---

## 2. Storage Layout (SSD + HDD Tiers)

Mount fast SSD storage for active vaults and SQLite WAL, and your large HDD array for automated backups:

```text
/mnt/ssd/cortexmd/data/          <-- bind-mounted to container /data (CORTEX_DATA_DIR=/data)
  ├── cortex.db                  <-- SQLite WAL database (FTS5, links, chunks, versions, ACLs, audit)
  └── vaults/
      ├── personal/*.md
      ├── homelab/*.md
      └── ai-research/*.md

/mnt/hdd/cortexmd-backups/       <-- bind-mounted to container /data/backups
  └── <slug>-<timestamp>.json    <-- Portable backup bundles generated via UI / API
```

> **UID Permission Note:** The Docker container runs as non-root user `cortex` (`UID 1001`, `GID 1001`). Ensure host bind directories are writable:
> ```bash
> mkdir -p /mnt/ssd/cortexmd/data/vaults /mnt/hdd/cortexmd-backups
> chown -R 1001:1001 /mnt/ssd/cortexmd/data /mnt/hdd/cortexmd-backups
> ```

---

## 3. Deploying with Docker Compose (Recommended)

Can be deployed inside an unprivileged Debian/Ubuntu Proxmox LXC (with `nesting=1`) or a lightweight Docker VM.

1. **Copy repository & configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` before first boot:
   ```dotenv
   CORTEX_PORT=3000
   CORTEX_HOST_DATA_PATH=/mnt/ssd/cortexmd/data
   CORTEX_HOST_BACKUP_PATH=/mnt/hdd/cortexmd-backups

   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=replace-with-strong-passphrase
   APP_SECRET=replace-with-32-plus-random-characters-for-aes-256-gcm
   ```

2. **Build and launch:**
   ```bash
   docker compose up -d --build
   ```

3. **Verify healthcheck:**
   ```bash
   curl -fsS http://127.0.0.1:3000/api/health
   ```
   Expected JSON: `{"ok":true,"status":"healthy","workspaces":...,"notes":...}`.

---

## 4. Direct Native LXC Deployment (Without Docker)

If running directly inside a Debian 12 / Ubuntu 24.04 Proxmox LXC:

1. Install **Node.js 24 LTS** (required for built-in `node:sqlite`).
2. Clone the repository and build:
   ```bash
   npm ci
   npm run build
   ```
3. Run via `systemd` with `CORTEX_DATA_DIR=/var/lib/cortexmd/data`:
   ```ini
   [Unit]
   Description=CortexMD AI Second Brain
   After=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/cortexmd
   EnvironmentFile=/opt/cortexmd/.env
   ExecStart=/usr/bin/node /opt/cortexmd/.next/standalone/server.js
   Restart=always
   User=cortex

   [Install]
   WantedBy=multi-user.target
   ```

---

## 5. Remote Access (VPN & Reverse Proxy)

CortexMD sets session cookies with `HttpOnly`, `SameSite=Lax`, and dynamic `Secure` detection (`https:` or `X-Forwarded-Proto: https`), so plain HTTP works on trusted home LANs/WireGuard and HTTPS works cleanly behind reverse proxies.

- **WireGuard / Tailscale (Simplest):** Bind `CORTEX_PORT=3000` on your Proxmox host or LXC Tailscale IP and access directly as `http://<tailscale-ip>:3000` with PWA **"Add to Home Screen"** support on iOS/Android/Desktop.
- **Caddy Reverse Proxy (HTTPS on Custom Domain):**
  ```caddyfile
  notes.homelab.example {
      reverse_proxy 127.0.0.1:3000 {
          flush_interval -1
      }
  }
  ```
  (`flush_interval -1` ensures SSE `/api/events` streams arrive immediately without buffering.)
- **External OAuth Proxy (Authelia / Authentik):** Set `TRUSTED_PROXY_AUTH_HEADER=Remote-User` (only when CortexMD is strictly firewalled behind your reverse proxy so spoofed client headers are stripped at the proxy).

---

## 6. AI Provider Setup & Licensing Truth

CortexMD works out of the box with **zero paid API keys** via `local-hybrid` (built-in SQLite FTS5 + 384-dim local semantic vector RAG + grounded synthesis + contradiction analysis). Additional optional backends can be enabled independently:

| Provider ID | Auth Method | Requirements / Licensing Notes |
|---|---|---|
| `local-hybrid` | None (Built-in) | Works offline/LAN immediately; no external calls or billing. |
| `gemini-cli` | Google OAuth CLI | Install `@google/gemini-cli` on host and run `gemini` once to complete official browser OAuth login. |
| `gemini-api` | API Key | Generate key in Google AI Studio (stored AES-256-GCM encrypted in SQLite). |
| `github-copilot` | Copilot CLI + PAT | Requires active GitHub Copilot subscription, official Copilot CLI installed in `PATH`, and fine-grained PAT (`Copilot Requests`) as `COPILOT_GITHUB_TOKEN`. |
| `jetbrains-junie` | Junie CLI + Key | Headless Junie CLI binary (`junie`) + `JUNIE_API_KEY` from JetBrains account. |
| `ollama` | Local HTTP | Point `OLLAMA_BASE_URL` to a LAN/host Ollama instance (e.g. `http://host.docker.internal:11434`). |

---

## 7. Backup, Recovery & Safe Upgrades

- **Plain-File Backups:** Since all vaults live in `/mnt/ssd/cortexmd/data/vaults/`, standard `rsync`, `restic`, or `borg` jobs to your HDD array (`rsync -a --delete /mnt/ssd/cortexmd/data/vaults/ /mnt/hdd/cortexmd-backups/vaults-mirror/`) preserve 100% of notes, folders, YAML frontmatter, and attachments.
- **Export Snapshots:** Click **Settings → Export Vault Backup JSON** (`GET /api/workspaces/<slug>/export?saveSnapshot=true`) to write a self-contained JSON snapshot directly to `/data/backups`.
- **Safe Application Updates:**
  ```bash
  git pull
  docker compose up -d --build
  ```
  Because `/data` lives outside the container image, upgrading the app container never touches user Markdown vaults or `cortex.db`.
- **Disaster Index Rebuild:** Even if `cortex.db` is deleted completely, restarting CortexMD automatically scans `/data/vaults/` and rebuilds FTS5 search, backlinks, tags, and semantic embeddings from the raw `.md` files.
