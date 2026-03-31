# ShiftClock

A real-time shift management tool built for small operations teams that run 24/7 across timezones. You get a clock view, a timeline, an overtime tracker, and a clean admin flow — all in one place, no spreadsheets required.

Built this because tracking who's on, who's off, and who owes overtime was a mess. This solves that.

---

## What it does

**Dashboard** is the main screen. Pick a day of the week and see every agent's shift on a 24h clock or a horizontal timeline. Shift levers let you shrink or extend shifts in real time — shrinking frees up hours, extending logs overtime. The clock updates live with the current UTC hand.

**Activity Log** keeps a full audit trail of every shift change and overtime event. The overtime panel shows pending/approved/paid records and lets an admin cycle through statuses or deny them.

**Profiles** is where you manage agents — name, color, timezone, role, shift template, and break time. Weekly templates apply shifts to every day at once.

---

## Core mechanics

**Shift levers** — each agent card has a draggable bar. Drag the ends to shrink or extend. Shrinking marks those hours as freed. Extending logs overtime. Changes go to the database immediately.

**Overtime transfer** — when an agent frees hours, an admin can click the freed segment and assign those hours to another agent. The receiving agent gets a coverage record that shows on the clock and timeline. The giving agent's shift stays shrunk.

**Overnight shifts** — shifts that cross midnight (e.g. 23:00–07:00) are handled correctly. The clock renders them as an arc that wraps around. The timeline splits them across the day boundary.

**Admin gate** — on load you either enter the admin password or continue view-only. Without admin you can see everything but can't move levers or assign overtime.

---

## Stack

```
Frontend: React 18, TypeScript, Vite, TailwindCSS, TanStack Query, Radix UI, Wouter
Backend:  Express 5, SQLite (better-sqlite3), Drizzle ORM, Zod
Deploy:   Railway (auto-deploy from main)
```

---

## Structure

```
client/src/
  pages/
    Dashboard.tsx     — main view: clock, timeline, levers, coverage
    ActivityLog.tsx   — activity feed + overtime approval panel
    Profiles.tsx      — agent and shift management
  components/
    Sidebar.tsx       — navigation and UTC clock
    ui/               — Radix-based UI primitives
  hooks/
    use-admin-mode.tsx
    use-drag-scroll.tsx
    useSoothingSounds.ts
  lib/
    shiftUtils.ts     — all shift/overtime math lives here
    queryClient.ts

server/
  routes.ts           — REST API endpoints
  storage.ts          — data access layer
  db.ts               — SQLite connection

shared/
  schema.ts           — Drizzle schema, shared types
```

---

## Running locally

```bash
git clone https://github.com/gabullish/shiftclock.git
cd shiftclock
npm install
cp .env.example .env   # set ADMIN_TOKEN here
npm run dev
```

```bash
npm run build    # production build
npm start        # serve production build
npm run check    # TypeScript type check
npm run db:push  # apply schema changes
```

---

## API

```
GET/POST        /api/agents
PATCH/DELETE    /api/agents/:id
POST            /api/agents/:id/apply-week

GET/POST        /api/shifts
PATCH           /api/shifts/:id

GET/POST        /api/overtime
PATCH           /api/overtime/:id
POST            /api/overtime/assign

GET/POST        /api/agent-logs
```

---

Everything is UTC internally. Agent timezones are stored for display only.
