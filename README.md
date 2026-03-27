# ⚡ SHIFTMAXXING

> *your shifts are cooked. we're here to fix that.*

**ShiftClock** is a real-time shift command center that lets you visualize, manage, and optimize agent coverage across timezones. think of it as the **gigachad** of workforce scheduling — clock views, timelines, overtime flows, and vibes. all in one place.

no cap, this thing mogs every spreadsheet you've ever used.

---

## 🧠 why tho (value prop)

| problem | shiftmaxxing solution |
|---|---|
| "who's even online rn?" | real-time coverage bar shows who's **literally on shift right now** |
| "we have zero coverage at 3am" | per-hour coverage heatmap exposes every gap instantly |
| "overtime tracking is in ohio" | automatic overtime calc + approval workflow (pending → approved → paid) |
| "spreadsheets are NOT it" | circular clock + timeline views that actually go hard |
| "can someone cover my shift?" | one-click overtime transfer between agents |

---

## 🗺️ the pages (your rotation arc)

### 🎛️ Command (Dashboard)

this is the **main character page**. absolute unit of a dashboard.

#### clock mode 🕐

a 24-hour circular clock that shows every agent's shift as a color-coded arc. the yellow hand is the current UTC hour — it rotates in real time. you literally watch coverage happen.

```
           12
        ╱──────╲
      ╱  🟡 UTC   ╲
    ╱   hand spins   ╲
  18 ── ══ agent ══ ── 6
    ╲   arcs glow    ╱
      ╲            ╱
        ╲──────╱
           0
```

#### timeline mode 📊

two flavors:
- **day view** — horizontal bars per agent, one day at a time. clean. readable. no cap.
- **14-day view** — compressed calendar timeline. drag-scroll enabled so you can **whoosh** through two weeks of coverage like it's nothing.

> 💡 **pro tip**: click any day label in 14-day view to zoom into that specific day. we're not gatekeeping UX.

#### the online now bar 🟢

top of the dashboard. shows every agent currently on shift. updates every second. you will never wonder "wait who's working" again. that era is **over**.

#### coverage analytics 📈

see exactly how many agents are covering each hour. spots zero-coverage gaps. finds peak hours. calculates total overtime vs released hours. this data is **bussin**.

---

### 📋 Activity Log

two tabs. both go crazy.

#### activity feed 🖥️

terminal-style chronological log of **everything** that happens:

```
[2026-03-27 14:32 UTC]  overtime-extended
  → Agent 2 extended shift by 2.0h on 2026-03-27

[2026-03-27 14:30 UTC]  shift-freed
  → Agent 1 freed 3.5h from their 2026-03-27 shift

[2026-03-27 14:28 UTC]  shift-claimed
  → Agent 3 claimed 3.5h freed from Agent 1's shift
```

full audit trail. no sketchy edits go unnoticed. **accountability maxxing**.

#### overtime panel 📊

all overtime records in one place with:
- summary cards (pending / approved / paid / denied counts)
- clickable status badges — click to cycle: `pending → approved → paid`
- deny / reopen actions for when someone's overtime is **sus**

---

### 👥 Agents (Profiles)

manage your whole roster:

- **create agents** with custom name, color, timezone, role, and avatar
- **edit shifts** — apply weekly templates (start/end times for Mon-Fri)
- **set breaks** — 30-min fixed breaks (warns if break is too early/late in shift, we're not letting you be cooked)
- **toggle off-days** — switch between Sat/Sun off or Thu/Fri off (rotating cycle for those global teams)
- **color-coded cards** — each agent gets their own color. the clock arcs, timeline bars, and cards all match. aesthetic **maxxing**.

---

## 🎮 core features (the lore)

### ⚡ shift levers

the **signature mechanic**. every shift has draggable levers that let you extend or shrink it in real time without touching the base schedule.

```
base shift:    |████████████|
                9:00      17:00

lever extended: |████████████████|
                9:00           19:00  (+2h overtime)

lever shrunk:  |████████|
                9:00   15:00  (freed 2h)
```

changes persist to the database. the clock and timeline update instantly. overtime is calculated automatically.

this feature single-handedly **mogs** every scheduling tool that makes you edit the actual schedule to track overtime.

### 🔄 overtime transfer (shift claiming)

when agent A frees up hours by shrinking their shift, that time becomes **"up for grabs"**.

**the flow:**
1. agent A shrinks their shift via lever (frees 3h)
2. admin clicks the freed segment on clock or timeline
3. modal pops up — pick which agent gets the hours
4. agent B's shift extends by those hours
5. overtime record created automatically
6. activity logged for full audit trail

```
Agent A:  |████████████|  →  |████████|     (freed 3h)
Agent B:  |████████████|  →  |████████████████|  (claimed 3h)
```

**no more "hey can someone take my hours" in the group chat.** it's all tracked. it's all logged. we're so back.

### 📊 overtime tracking & approval

every overtime hour gets logged with:
- how many hours
- who worked them
- **origin** (manager-extended or claimed-from-agent)
- **status workflow**: `pending` → `approved` → `paid` (or `denied`)
- timestamp for when status changed

click the status badge in the overtime panel to cycle through. it's literally that easy. your payroll team will **thank you**.

### 🔊 soothing sounds

yeah we added sound design to a scheduling app. what about it.

- **soft click** (680Hz, 150ms) — plays on navigation and interactions
- **drag whoosh** (filtered noise sweep, 400ms) — plays when you drag-scroll the timeline
- **success chord** (520→680Hz, 350ms) — plays when you successfully assign overtime

all generated via Web Audio API. no audio files. pure synthesis. **audiophile maxxing**.

### 🖱️ drag scroll

in 14-day timeline view, click and drag to pan horizontally. it's smooth. it whooshes. it feels like butter. togglable via sidebar button. state persists in localStorage because we respect your preferences.

---

## 🔐 admin mode

some features (like overtime assignment) require admin access.

**to activate:** add `?admin=shiftclock-admin-2024` to your URL before the hash:

```
https://your-app.railway.app?admin=shiftclock-admin-2024#/
```

this unlocks:
- ✅ clicking freed segments to assign overtime
- ✅ shift lever adjustments
- ✅ full CRUD on agents and shifts

without admin mode you can still view everything — it's read-only, not gatekept.

---

## 🚀 run locally (speedrun any%)

```bash
# clone it
git clone https://github.com/gabullish/shiftclock.git
cd shiftclock

# install deps
npm install

# start dev server (Express + Vite HMR)
npm run dev
```

open the URL from terminal output. that's it. you're **in**.

### other commands

```bash
npm run build    # production build (client + server bundled)
npm start        # run production build
npm run check    # TypeScript type check (0 errors or we don't ship)
npm run db:push  # apply schema migrations
```

---

## 🏗️ tech stack (the build)

```
Frontend                          Backend
├── React 18 + TypeScript 5.6     ├── Express 5
├── Vite 7.3                      ├── SQLite (better-sqlite3)
├── TanStack Query v5             ├── Drizzle ORM
├── Tailwind CSS 3.4              ├── Zod validation
├── Radix UI components           └── Node 20.x
├── Wouter (hash routing)
├── Framer Motion
├── Lucide icons
└── Web Audio API (sounds)
```

deployed on **Railway** — auto-deploys from `main`. push and pray (jk, we have type checking).

---

## 🗃️ project structure

```
shiftclock/
├── client/src/
│   ├── pages/
│   │   ├── Dashboard.tsx      # the main character
│   │   ├── ActivityLog.tsx    # feed + overtime panel
│   │   └── Profiles.tsx       # agent management
│   ├── components/
│   │   ├── Sidebar.tsx        # nav + UTC clock
│   │   └── ui/                # radix-based components
│   ├── hooks/
│   │   ├── use-admin-mode.tsx # admin token check
│   │   ├── use-drag-scroll.tsx
│   │   └── useSoothingSounds.ts
│   └── lib/
│       └── shiftUtils.ts      # all the shift math
├── server/
│   ├── routes.ts              # API endpoints
│   ├── storage.ts             # data access layer
│   └── db.ts                  # SQLite connection
└── shared/
    └── schema.ts              # Drizzle schema (source of truth)
```

---

## 📡 API endpoints (for the nerds)

```
GET    /api/agents                 list all agents
POST   /api/agents                 create agent
PATCH  /api/agents/:id             update agent
DELETE /api/agents/:id             delete agent
POST   /api/agents/:id/apply-week  apply shift template

GET    /api/shifts                 list all shifts
POST   /api/shifts                 create/upsert shift
PATCH  /api/shifts/:id             update shift

GET    /api/overtime               list overtime records
POST   /api/overtime               create overtime record
PATCH  /api/overtime/:id           update status
POST   /api/overtime/assign        transfer freed time

GET    /api/agent-logs             activity log
POST   /api/agent-logs             log an action
```

---

## 🌙 the aesthetic

solflare-inspired dark theme:
- **background**: deep matte slate `#141720`
- **accent**: golden yellow `#FFD700`
- **cards**: dark blue-slate `#181d28`
- **sidebar**: darker slate `#0f1219`

everything is yellow-on-dark. it goes **unreasonably hard** for a scheduling app.

---

## 💀 FAQ

**Q: is this just a fancy spreadsheet?**
A: that's like calling a lambo "just a car." technically yes. spiritually? absolutely not.

**Q: why are there sound effects?**
A: because scheduling without whoosh sounds is **mid**.

**Q: what timezone does everything use?**
A: UTC. always UTC. we're not doing timezone math in 2026. agents have their local timezone stored for display but all shift times are UTC internally.

**Q: can I use this for my team?**
A: yes. clone it, deploy it, shiftmaxx to your heart's content.

**Q: the coverage chart shows a gap at 4am, should I be worried?**
A: you're **cooked** if nobody's covering 4am. go to the dashboard and fix that asap.

---

<p align="center">
  <b>stop being mid at scheduling. start shiftmaxxing.</b>
  <br><br>
  built with 💛 and an unreasonable amount of SVG math
</p>
