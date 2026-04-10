# ShiftClock — Code Quality Pass

Senior-engineer-level refactor. No new features. No behavior changes. Clean, modular, professional.

---

## STATUS LEGEND
- ✅ Done
- 🔲 Not started
- ⚠️ Partial

---

## PASS 1 — AUDIT (reference)

### App summary
ShiftClock is a real-time shift management tool for 24/7 distributed support teams. It shows every agent's shift on a 24h clock or scrollable timeline, lets managers shrink/extend shifts live, tracks overtime through an approval pipeline, and maintains a full audit log of every change.

### Stack
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, TanStack Query v5, Radix UI, Wouter (hash routing)
- **Backend**: Express 5, SQLite (better-sqlite3), Drizzle ORM, Zod
- **Deploy**: Railway (auto-deploy from main)

### File structure (post-refactor state)
```
client/src/
  pages/
    Dashboard.tsx          — ~1,030 lines  — data, state, layout shell ✅ split
    Profiles.tsx           — ~380 lines    — agent management shell ✅ split
    ActivityLog.tsx        — thin shell    — activity/overtime page ✅ split
    not-found.tsx          — 404 page

  components/
    Sidebar.tsx            — nav + UTC clock
    AppFooter.tsx          — footer strip ✅ extracted
    dashboard/
      KpiCell.tsx          — ✅ extracted
      AgentBreakControl.tsx — ✅ extracted
      EmptyState.tsx       — ✅ extracted
      SummaryPanel.tsx     — ✅ extracted
      AssignOvertimeModal.tsx — ✅ extracted
      ShiftLever.tsx       — ✅ extracted
      ClockVisualizer.tsx  — ✅ extracted
      UnifiedTimeline.tsx  — ✅ extracted
    profiles/
      AgentForm.tsx        — agent create/edit form ✅ extracted
      ShiftPill.tsx        — per-day shift pill + break controls ✅ extracted
      ApplyWeekRow.tsx     — apply-week template row ✅ extracted
    activity/
      ActivityFeed.tsx     — activity log tab ✅ extracted
      OvertimePanel.tsx    — overtime approval tab ✅ extracted
    ui/                    — Radix/shadcn primitives (do not touch)

  hooks/
    use-admin-mode.tsx     — AdminContext + useAdminMode
    use-agent-session.ts   — ✅ extracted from App.tsx
    use-drag-scroll.tsx    — pointer-capture drag for timeline
    use-soothing-sounds.ts — audio feedback ✅ renamed from useSoothingSounds.ts
    use-toast.ts           — toast hook
    use-mobile.tsx         — viewport width hook (check if used)

  lib/
    adminAccess.ts         — token read/write for admin mode
    agentAccess.ts         — token read/write for agent mode + session lifecycle
    dashboardUtils.ts      — ✅ extracted — shared types + pure utils for dashboard
    queryClient.ts         — TanStack Query client + apiRequest
    shiftUtils.ts          — all shift math (large, but single responsibility)
    utils.ts               — cn() helper only

  App.tsx                  — root: auth gate, routing, idle timeout
  main.tsx                 — entry point

server/
  routes.ts                — all API routes (check size)
  storage.ts               — DB access layer
  db.ts                    — Drizzle init
  index.ts                 — Express setup

shared/
  schema.ts                — Drizzle schema + Zod types (source of truth)
```

---

## PASS 3 — IMPLEMENTATION STATUS

### Group 1: Safe deletes ✅ Done

| Item | Status | Notes |
|---|---|---|
| Delete `PerplexityAttribution.tsx` | ✅ Done | Was never imported anywhere |
| Extract `useAgentSession` hook | ✅ Done | Now lives in `hooks/use-agent-session.ts` |

---

### Group 2: File splits ✅ Done

| File | Before | After | Status |
|---|---|---|---|
| `Profiles.tsx` | 996 lines | ~380 lines | ✅ Done |
| `ActivityLog.tsx` | large | thin shell | ✅ Done |
| `AppFooter.tsx` | inline in App.tsx | own file | ✅ Done |
| `Dashboard.tsx` | 3,207 lines | ~1,030 lines | ✅ Done |
| `lib/dashboardUtils.ts` | (didn't exist) | ~155 lines | ✅ Created |

All 8 dashboard sub-components extracted to `client/src/components/dashboard/`.

---

### Group 3: Deduplication ⚠️ Partial

| Item | Status | Notes |
|---|---|---|
| `seedFromShifts` duplicated in ShiftPill + ApplyWeekRow | ✅ Accepted | Intentional — avoids premature shared util |
| `HALF_HOUR_OPTIONS` duplicated in ShiftPill + ApplyWeekRow | ✅ Accepted | Same reason |
| `hexToRgba` duplicated in ClockVisualizer + UnifiedTimeline | ✅ Accepted | SVG-only helper; not worth a shared module |
| `formatUtcHour` / shift math — check for any duplication vs shiftUtils | ✅ Clean | No duplication found |

---

### Group 4: Naming cleanup ✅ Done

| Item | Status | Notes |
|---|---|---|
| `useSoothingSounds.ts` → `use-soothing-sounds.ts` | ✅ Done | |
| `useAgentSession` extracted to `hooks/use-agent-session.ts` | ✅ Done | |
| All consumers updated to import from new path | ✅ Done | Dashboard, Profiles, ActivityLog |
| Re-export shim kept in App.tsx during migration | ✅ Done | |

---

### Group 5: Logic fine-tuning ✅ Done

| Item | Status | Notes |
|---|---|---|
| Stable empty arrays `NO_AGENTS / NO_SHIFTS / NO_OT` | ✅ Done | Prevents spurious effect re-runs |
| `leverState` effect functional updater bail-out | ✅ Done | Prevents render loop |
| `visibleInitialized` ref guard | ✅ Done | Prevents double-init in StrictMode |
| `SummaryPanel` — replaced `}: any` with full typed interface | ✅ Done | `AgentSummary` type + `GapSlice` + `TooltipInfo` |
| `InsertShift` typed mutations in Profiles + ShiftPill | ✅ Done | |
| `BAR_MAX = 48` named constant in ShiftLever | ✅ Done | Was inline `barMax = 48` |
| Stable ref for `agentsForStatus = []` in App.tsx | ✅ Done | `NO_AGENTS` module-level constant |

---

### Group 6: Comments ✅ Done

| File | What was added |
|---|---|
| `App.tsx` | Top-of-file comment + idle timeout WHY comment |
| `agentAccess.ts` | Session lifecycle explanation block |
| `shiftUtils.ts` | `resolveBreak` isBadTiming WHY comment |
| `ApplyWeekRow.tsx` | `forceDirty` prop WHY comment |
| `Dashboard.tsx` | Top-of-file comment |
| `dashboardUtils.ts` | Top-of-file comment |
| `ClockVisualizer.tsx` | Top-of-file comment |
| `UnifiedTimeline.tsx` | Top-of-file comment |
| All other extracted components | Top-of-file comments |

---

### Group 7: UI copy ⚠️ Partial

| Item | Status | Notes |
|---|---|---|
| Loading ellipsis consistency (`...` → `…`) | ✅ Done | `Saving…`, `Undoing…`, `Joining…` |
| Check all empty states have helpful messages | ✅ Done | EmptyState.tsx has weekend vs no-shifts variants |
| Check all toast messages are consistent in tone/casing | 🔲 | Quick audit still pending |

---

### Group 8: Repo hygiene 🔲 Not started

| Item | Status | Notes |
|---|---|---|
| README rewrite | 🔲 | Current README is reasonable but thin on env vars, auth, Railway setup |
| GitHub repo description (one-liner) | 🔲 | Write for user to paste into GitHub Settings |
| `.gitignore` audit | 🔲 | Check it covers `.env`, `*.db`, Railway artifacts |

**README missing sections:**
- Environment variables (`ADMIN_PASSWORD`, `AGENT_PASSWORD`, session secret)
- How Railway volume mount works for SQLite persistence
- Auth flow explanation (admin token, agent session, view-only)
- Break endpoint docs
- API endpoint summary

---

### Group 9: Token optimization ✅ Done

| Item | Status | Notes |
|---|---|---|
| Profiles.tsx split | ✅ Done | -616 lines |
| ActivityLog.tsx split | ✅ Done | |
| Dashboard.tsx split | ✅ Done | -2,177 lines (3,207 → ~1,030) |
| Dead code removal | ✅ Done | PerplexityAttribution.tsx deleted |

---

## REMAINING WORK

### 1. README rewrite (30 min)
Rewrite README with env vars, auth flow, Railway setup.
Write GitHub repo description one-liner.

### 2. UI copy audit (15 min)
Scan toast messages for tone/casing consistency.

### 3. `use-mobile.tsx` check (5 min)
Confirm it's used; delete if unused.
