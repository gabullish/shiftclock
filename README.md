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
Backend:  Express 5, SQLite (better-sqlite3), Drizzle ORM, Zod
Deploy:   Railway (auto-deploy from main)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Password for admin mode. Set on Railway or in `.env`. |
| `AGENT_PASSWORD` | No | Enables agent login mode. Omit to disable agent accounts. |
| `DATABASE_URL` | No | SQLite file path. Defaults to `./data/shiftclock.db`. |
| `SESSION_SECRET` | No | Express session secret. Defaults to a random value (sessions reset on restart). |
| `PORT` | No | HTTP port. Defaults to `5000`. |

Copy `.env.example` to `.env` and fill in at minimum `ADMIN_PASSWORD`.

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

1. **Admin** — enters `ADMIN_PASSWORD` on the lock screen. A hashed token is stored in `localStorage`. No sessions, no server state. Clears on sign-out.

2. **Agent** — enters `AGENT_PASSWORD` + selects their name. Server validates and returns a short-lived token (`x-agent-session` header). Token is stored in `sessionStorage` and expires after 4 minutes of inactivity. Agents can only edit their own shift lane and toggle their own break.

3. **View-only** — no password. Everything visible, nothing editable.

---

## Railway deployment

ShiftClock stores its SQLite database at the path set by `DATABASE_URL` (default `./data/shiftclock.db`).

**To persist data across deploys**, attach a Railway Volume and mount it at `/app/data`. Set `DATABASE_URL=/app/data/shiftclock.db` in Railway environment variables.

Without a volume, the database resets on every redeploy (fine for testing, bad for production).

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
