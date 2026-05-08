# VegaWiFi — 802.1X Wi-Fi AAA Management Portal

A production-ready web portal for managing enterprise Wi-Fi authentication, built on **FreeRADIUS**, **MariaDB**, and **Active Directory / LDAP**. Designed for Huawei AC + AP infrastructure with full 802.1X EAP-PEAP support.

---

## Features

| Category | Capability |
|----------|-----------|
| **Authentication** | Local DB, LDAP/AD-only, or Hybrid (DB + LDAP fallback) |
| **Sessions** | Live active session table; CoA Disconnect-Request (RFC 3576) to Huawei AC |
| **Accounting** | Paginated log with filters; streaming CSV export |
| **Users** | Local RADIUS user CRUD; AD group member view; block/unblock both sources |
| **Policy** | Global auth mode, simultaneous-use limit, NAS/AC management |
| **Diagnostics** | `radtest` auth test; LDAP connection test; live FreeRADIUS log tail (SSE) |
| **Setup Wizard** | 5-step first-run wizard writes all FreeRADIUS config files and reloads the service |
| **Security** | AES-256-GCM for secrets at rest; httpOnly JWT cookies; rate-limited login; LDAPS-only |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                Ubuntu 22.04 VM               │
│                                             │
│  ┌──────────┐    ┌──────────────────────┐   │
│  │  Nginx   │    │  FastAPI (uvicorn)   │   │
│  │  :443    │───▶│  127.0.0.1:8000      │   │
│  │  TLS     │    │  portaluser account  │   │
│  └──────────┘    └──────────┬───────────┘   │
│       │                     │               │
│  React SPA              MariaDB             │
│  /opt/portal/           (radius DB)         │
│  frontend/dist/             │               │
│                         FreeRADIUS 3.x      │
│                         :1812/:1813 UDP     │
└─────────────────────────────────────────────┘
          ▲                    ▲
          │ HTTPS              │ RADIUS
    Admin browser        Huawei AC6508
                         (802.1X clients)
```

**Stack:**
- **Backend:** Python 3.11, FastAPI, aiomysql, ldap3, python-jose, cryptography, slowapi
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Axios, React Router v6
- **RADIUS:** FreeRADIUS 3.x with `rlm_sql` (MariaDB) and `rlm_ldap`
- **Web server:** Nginx — serves React SPA, proxies `/api/` to FastAPI
- **Process manager:** systemd (`portal-backend.service`)

---

## Requirements

- **OS:** Ubuntu 22.04 LTS (fresh install recommended)
- **RAM:** 2 GB minimum
- **Disk:** 10 GB minimum
- **Network:** Static IP on management VLAN
- **Huawei AC:** Configured to send RADIUS requests to this VM's IP

---

## Installation

Clone the repository onto the target VM, then run the installer as root:

```bash
git clone https://github.com/dipakchaulagain/VegaWiFi.git
cd VegaWiFi
sudo bash install.sh [MANAGEMENT_VLAN_IP] [HUAWEI_AC_IP]
```

Both arguments are optional:
- `MANAGEMENT_VLAN_IP` — defaults to the first IP returned by `hostname -I`
- `HUAWEI_AC_IP` — if provided, UFW restricts RADIUS ports (1812/1813/3799 UDP) to this IP only. If omitted, those ports are open to all (not recommended for production).

**Example:**
```bash
sudo bash install.sh 10.10.10.5 10.10.10.1
```

The installer will:
1. Install all required packages (`freeradius`, `mariadb-server`, `nginx`, `nodejs`, `npm`, `easy-rsa`, …)
2. Generate random `DB_PASS`, `JWT_SECRET`, and `AES_KEY` — written to `/opt/portal/.env` (mode 600)
3. Create the `radius` database and import the FreeRADIUS schema
4. Create portal tables (`app_config`, `audit_log`, `portal_users`)
5. Set up a Python virtualenv and install Python dependencies
6. Build the React frontend (`npm ci && npm run build`)
7. Generate a self-signed TLS certificate for Nginx
8. Install the Nginx site config and systemd unit
9. Configure UFW firewall rules
10. Enable and start all services

When complete:

```
============================================================
  Setup complete!
  Visit: https://<MANAGEMENT_VLAN_IP>/setup
  to complete the first-run configuration wizard.
============================================================
```

---

## First-Run Setup Wizard

Navigate to `https://<vm-ip>/setup` in a browser. The wizard has five steps:

| Step | What you configure |
|------|--------------------|
| 1 — Auth Mode | Local DB / LDAP only / Hybrid |
| 2 — LDAP Config | Server URL (`ldaps://`), bind DN/PW, base DN, group DN, user filter. Includes a live **Test Connection** button — you cannot advance until the test passes. |
| 3 — RADIUS / AC | Shared secret, Huawei AC IP address, shortname |
| 4 — EAP Certificate | Generate self-signed CA via easy-rsa **or** supply an existing PEM path |
| 5 — Admin Account | Portal admin username + password. Summary of all settings before final submit. |

On submission the wizard:
- Encrypts LDAP bind PW and RADIUS shared secret with AES-256-GCM
- Writes all FreeRADIUS config files (`ldap`, `sql`, `clients.conf`, `policy.d/concurrent_limit`)
- Reloads FreeRADIUS
- Creates the admin portal account
- Auto-logs you in and redirects to the Dashboard

---

## Project Structure

```
/opt/portal/
├── install.sh                    # Automated Ubuntu 22.04 installer
├── .env                          # Generated secrets (mode 600, never committed)
├── backend/
│   ├── main.py                   # FastAPI app entry point
│   ├── config.py                 # Settings from .env (pydantic-settings)
│   ├── database.py               # aiomysql connection pool
│   ├── auth.py                   # JWT + bcrypt helpers
│   ├── requirements.txt
│   ├── routers/
│   │   ├── setup.py              # /api/v1/setup/*  (wizard, unauthenticated)
│   │   ├── auth.py               # /api/v1/auth/login, /logout
│   │   ├── dashboard.py          # /api/v1/dashboard/summary
│   │   ├── sessions.py           # /api/v1/sessions/active, DELETE /{id}
│   │   ├── accounting.py         # /api/v1/accounting, /export
│   │   ├── users.py              # /api/v1/users/local + /ldap
│   │   ├── policy.py             # /api/v1/policy, /nas CRUD
│   │   └── diagnostics.py        # /api/v1/diagnostics/* + SSE log stream
│   ├── services/
│   │   ├── radius_db.py          # All MariaDB queries (parameterized)
│   │   ├── ldap_client.py        # ldap3 wrapper (LDAPS, cert validation)
│   │   ├── config_writer.py      # Jinja2 render → write → reload FreeRADIUS
│   │   ├── coa_sender.py         # RFC 3576 Disconnect-Request via radclient
│   │   └── audit.py              # audit_log writes
│   ├── models/                   # Pydantic request/response schemas
│   └── templates/                # Jinja2 templates for FreeRADIUS configs
│       ├── ldap.conf.j2
│       ├── sql.conf.j2
│       ├── clients.conf.j2
│       └── concurrent_limit.j2
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── App.tsx               # Routes
│       ├── api/                  # Axios API wrappers per domain
│       ├── pages/                # Setup, Login, Dashboard, Sessions,
│       │                         # Accounting, Users, UserDetail,
│       │                         # Policy, Diagnostics
│       └── components/           # Layout, ProtectedRoute, DataTable,
│                                 # StatusBadge, BlockToggle, ConfirmDialog
└── nginx/
    └── portal.conf               # Nginx server block (TLS, proxy, SPA fallback)
```

---

## Database Schema

### FreeRADIUS tables (imported from standard schema)

| Table | Purpose |
|-------|---------|
| `radcheck` | Per-user auth checks and policy attributes (`Cleartext-Password`, `Simultaneous-Use`, `Auth-Type := Reject`) |
| `radreply` | Reply attributes sent on Access-Accept |
| `radacct` | Accounting records (session start/stop/update) |
| `radpostauth` | Auth attempt log (used for history and dashboard metrics) |
| `nas` | NAS/AP-Controller entries (populated by portal) |

### Portal-owned tables

| Table | Purpose |
|-------|---------|
| `app_config` | Key-value store for portal configuration (LDAP settings, auth mode, encrypted secrets) |
| `audit_log` | Immutable log of every admin action with actor, target, detail JSON, and IP |
| `portal_users` | Portal login accounts (bcrypt-hashed passwords, separate from RADIUS users) |

---

## Security Model

| Concern | Implementation |
|---------|---------------|
| **Secrets at rest** | LDAP bind PW and RADIUS shared secret encrypted with AES-256-GCM; AES key only in `/opt/portal/.env` (mode 600), never in the database |
| **Session auth** | JWT in `httpOnly; Secure; SameSite=Strict` cookie named `portal_token`; 8-hour expiry |
| **Brute force** | Login endpoint rate-limited to 10 requests/minute per IP via `slowapi` |
| **LDAP** | LDAPS (port 636) only; server certificate validated against system trust store |
| **Subprocess calls** | All `radclient`, `radtest`, `systemctl`, `easy-rsa` calls use explicit argument lists — no `shell=True` |
| **SQL** | Parameterized queries throughout — no string interpolation into SQL |
| **Nginx headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`, `HSTS` |
| **Firewall** | UFW: only port 443/tcp open on management VLAN IP; RADIUS UDP ports optionally scoped to AC IP only |
| **Principle of least privilege** | Backend runs as `portaluser` (no shell, no home); only sudoers permission is `systemctl reload freeradius` |

---

## API Reference

All endpoints are under `/api/v1/`. Interactive docs available at `https://<vm-ip>/api/docs` (Swagger UI).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/setup/status` | No | Check if setup is complete |
| `POST` | `/setup/test-ldap` | No | Test LDAP credentials during wizard |
| `POST` | `/setup/generate-eap-cert` | No | Run easy-rsa to generate EAP certs |
| `POST` | `/setup/init` | No | Complete wizard — writes configs, creates admin user |
| `POST` | `/auth/login` | No | Authenticate; sets `portal_token` cookie |
| `POST` | `/auth/logout` | No | Clears cookie |
| `GET` | `/dashboard/summary` | Yes | Metrics + recent sessions |
| `GET` | `/sessions/active` | Yes | All active RADIUS sessions |
| `DELETE` | `/sessions/{id}` | Yes | CoA Disconnect-Request to NAS |
| `GET` | `/accounting` | Yes | Paginated accounting log |
| `GET` | `/accounting/export` | Yes | Streaming CSV download |
| `GET/POST/PUT/DELETE` | `/users/local[/{username}]` | Yes | Local RADIUS user CRUD |
| `POST` | `/users/local/{username}/block` | Yes | Add `Auth-Type := Reject` |
| `POST` | `/users/local/{username}/unblock` | Yes | Remove reject entry |
| `GET` | `/users/ldap` | Yes | AD group members enriched with RADIUS data |
| `POST` | `/users/ldap/{username}/block` | Yes | Block an LDAP user |
| `GET/PUT` | `/policy` | Yes | Read / update global policy + trigger config reload |
| `GET/POST/PUT/DELETE` | `/nas[/{id}]` | Yes | NAS entry CRUD + config reload |
| `POST` | `/diagnostics/test-auth` | Yes | Run `radtest` against localhost |
| `POST` | `/diagnostics/test-ldap` | Yes | Test saved LDAP config |
| `GET` | `/diagnostics/log-stream` | Yes | SSE stream of FreeRADIUS log |

---

## Huawei AC Configuration

Configure the Huawei AC (AC6508 or similar) to point RADIUS Authentication and Accounting at the portal VM:

```
# On Huawei AC — example CLI snippet
radius-server template VegaWiFi
 radius-server authentication <VM_IP> 1812
 radius-server accounting <VM_IP> 1813
 radius-server shared-key cipher <shared_secret>

# Enable CoA (for session disconnect)
radius-server template VegaWiFi
 radius-server authorization <VM_IP> shared-key cipher <shared_secret>
```

The shared secret must match what was entered in Step 3 of the setup wizard.

---

## Re-running the Installer

The installer is idempotent for most steps. To upgrade or re-deploy on the same VM:

```bash
cd VegaWiFi
git pull
sudo bash install.sh
```

The existing `/opt/portal/.env` is **not overwritten** — only the `backend/`, `frontend/`, and `nginx/` directories are replaced. Generated secrets, the database, and all configuration entered through the wizard are preserved.

---

## Troubleshooting

**Backend not starting:**
```bash
journalctl -u portal-backend -f
```

**FreeRADIUS not reloading after config changes:**
```bash
sudo freeradius -X   # test mode — shows config errors
journalctl -u freeradius -f
```

**LDAP connection failing:**
- Ensure the LDAP server certificate is trusted: `openssl s_client -connect dc.domain.com:636`
- Add the CA certificate to `/usr/local/share/ca-certificates/` and run `update-ca-certificates`

**Nginx TLS errors in browser:**
- The self-signed certificate will trigger a browser warning — this is expected. Accept the exception or replace with a trusted cert at `/etc/nginx/ssl/portal.{crt,key}`.

**Check all service status at once:**
```bash
systemctl status portal-backend freeradius nginx mariadb
```

---

## License

MIT
