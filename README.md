# ShiftClock

Real-time shift management for 24/7 operations teams. Live 24h clock, horizontal timeline, shift levers, overtime approval pipeline, break tracking — no spreadsheets required.

---

## What it does

**Dashboard** — pick a day, see every agent's shift on a 24h SVG clock or a scrollable horizontal timeline. Shift levers let you shrink or extend shifts in real time. The clock hand updates live to the current UTC hour.

**Activity Log** — full audit trail of every shift change and overtime event. The overtime panel shows pending/approved/paid records; admins can approve, deny, or mark paid.

**Profiles** — manage agents (name, color, timezone, role), assign break times, and apply weekly shift templates in one click.

---

## Core mechanics

**Shift levers** — drag the ends of an agent's bar to shrink or extend. Shrinking marks those hours as freed (up for grabs). Extending logs overtime. Changes persist immediately.

**Coverage transfer** — when an agent frees hours, an admin (or the agent themselves) clicks the freed segment on the clock/timeline and assigns those hours to another agent. The receiving agent gets a coverage record that lights up on both views.

**Overnight shifts** — shifts crossing midnight (e.g. 23:00–07:00) store `endUtc > 24` internally (e.g. 31). The clock renders them as a wrapping arc; the timeline splits the bar across the day boundary.

**Auth modes** — three access levels: admin (full control), agent (own-lane edit + break toggle), view-only (no password). Each mode is gated at load.

---

## Stack

```
Frontend: React 18, TypeScript, Vite, TailwindCSS, TanStack Query v5, Radix UI, Wouter
Backend:  Express 5, libSQL/SQLite, Drizzle ORM, Zod
Deploy:   Render (auto-deploy from main)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_TOKEN` | Yes | Password for manager (admin) mode. Mutating admin endpoints return 500 until set. |
| `AGENT_PASSWORD` | No | Enables agent login mode. Omit to disable agent accounts (view-only + admin still work). |
| `TURSO_DATABASE_URL` | Prod | libSQL/Turso database URL. If unset, falls back to a local file (`file:./data.db`). **Required in production** on hosts with ephemeral disk (e.g. Render) so data survives restarts. |
| `TURSO_AUTH_TOKEN` | Prod | Auth token for the Turso database. Required alongside `TURSO_DATABASE_URL`. |
| `PORT` | No | HTTP port. Defaults to `5000`. |

Copy `.env.example` to `.env` and fill in at minimum `ADMIN_TOKEN`.

---

## Running locally

```bash
git clone https://github.com/gabullish/shiftclock.git
cd shiftclock
npm install
cp .env.example .env        # add ADMIN_PASSWORD at minimum
npm run dev                 # starts frontend + backend with hot reload
```

```bash
npm run build               # production Vite build
npm start                   # serve production build
npm run check               # TypeScript type check
npm run db:push             # push schema changes to SQLite
```

---

## Auth flow

1. **Admin** — enters `ADMIN_TOKEN` on the lock screen. The token is stored in `sessionStorage` (cleared when the tab closes) and sent as an `x-admin-token` header. No server-side sessions. Sign out from the sidebar to drop back to the lock screen.

2. **Agent** — enters `AGENT_PASSWORD` + selects their name. Server validates and returns a short-lived token (`x-agent-session` header). Token is stored in `sessionStorage` and expires after 4 minutes of inactivity. Agents can only edit their own shift lane and toggle their own break.

3. **View-only** — no password. Everything visible, nothing editable.

---

## Deployment (Render)

`render.yaml` builds the app fresh on every deploy (`npm run build`) and runs `npm start`. The build output (`dist/`) is **not** committed — the platform regenerates it, so a stale checked-in bundle can never silently override the source.

### Make data persist (important)

Render's local disk is **ephemeral** — anything written to `file:./data.db` is wiped on every redeploy and restart, and the app re-seeds 13 default agents. For real data, point ShiftClock at a free hosted [Turso](https://turso.tech) database:

1. Create a free Turso database (one-time, via Turso's dashboard or CLI). You'll get a URL like `libsql://your-db.turso.io` and an auth token.
2. In the Render dashboard → your service → **Environment**, set:
   - `TURSO_DATABASE_URL` = the `libsql://…` URL
   - `TURSO_AUTH_TOKEN` = the auth token
   - `ADMIN_TOKEN` = your chosen manager password
   - `AGENT_PASSWORD` = (optional) agent-mode password
3. Redeploy. The app creates its tables automatically on first boot (`initDb`).

> Alternative: a Render **persistent disk** (paid) mounted as the working dir also works with the default local-file DB — but Turso is free and survives across restarts with no disk to manage.

---

## API summary

```
GET    /api/agents                    list all agents
POST   /api/agents                    create agent
PATCH  /api/agents/:id                update agent fields
DELETE /api/agents/:id                delete agent
POST   /api/agents/:id/apply-week     bulk-apply shift template to all weekdays
POST   /api/agents/:id/break/start    start break (agent auth)
POST   /api/agents/:id/break/end      end break (agent auth)

GET    /api/shifts                    list all shifts
POST   /api/shifts                    create shift
PATCH  /api/shifts/:id                update shift (lever position, break time, etc.)
DELETE /api/shifts/:id                delete shift
POST   /api/shifts/reset-day          reset levers + pending OT for a given date

GET    /api/overtime                  list overtime/coverage records
POST   /api/overtime/assign           create coverage claim (freed hours or open gap)
PATCH  /api/overtime/:id              update status (pending → approved → paid / denied)
DELETE /api/overtime                  bulk delete by IDs

GET    /api/agent-logs                activity log entries
POST   /api/agent-logs                write a log entry

POST   /api/auth/agent-session        validate agent password + agentId, return token
GET    /api/auth/agent-password-configured   check if AGENT_PASSWORD is set
```

All timestamps are UTC. Agent timezones are stored for display only — they don't affect scheduling math.

---

## GitHub description

> Shift management for 24/7 teams — live clock, timeline, levers, overtime tracking, break alerts.
