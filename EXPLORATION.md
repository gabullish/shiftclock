# ShiftClock — Live Exploration Notes

Explored at: 2026-04-04 ~19:43 UTC
URL: https://shiftmaxxing.up.railway.app/#/
Access level: **Manager**

---

## Login Screen

Three access modes on load:
- **Manager** — full control (levers, OT approval, agent management)
- **Agent** — agent-scoped access (can claim/free hours on own shift)
- **View only** — read-only, no interactions

Password field is shared; the mode buttons distinguish which role to authenticate as.

---

## Command (Dashboard)

The main operational view. Accessed at `/#/`.

### Clock view (default)

A radial 24h clock with one concentric arc per agent. The current UTC time is shown as a live yellow hand. A legend on the right maps arc colors to states:

| Color / Style | Meaning |
|---|---|
| Solid arc | Covered (active shift) |
| Red dashed | Gap (uncovered hour) |
| Yellow dashed | Up for grabs (freed, claimable) |
| White dashed | Claim / preview |
| Lighter arc | Overtime |
| Break marker | ☕ Break |

Agent filter pills below the clock let you toggle individual agents on/off, or hide all.

Overnight shifts (23:00–07:00) render correctly as arcs that cross the 00 mark.

**Bottom stat bar:**
- `NO COVER` — total uncovered hours for the day
- `PEAK HR` — busiest coverage hour (e.g. 14:00)
- `OVERTIME` — net overtime delta

### Timeline view — Day

Switched via the **Timeline** button. Horizontal bar chart, one row per agent, x-axis = 24h UTC. Overnight shifts wrap with a `+1` label. A vertical "Now" line marks current UTC. Coverage density row (`COV`) at the bottom.

### Timeline view — 14D

Switched via the **14D** button. Shows a 14-day scrollable window (23/03–05/04 range observed). Instruction hint: `scroll to navigate · click day label → Day view`. Useful for spotting pattern gaps across two weeks.

### Shift Levers (below the clock)

Below the visualization, a `SHIFT LEVERS · MON 30/03` panel lists every agent with:
- Start time and end time labels
- `← 30m` / `30m →` buttons for both start and end (shift by half-hour)
- `☕ Set break` — places a 30-minute break near the center of the shift
- `Reset day` button — resets all levers and pending OT for the selected day

### Coverage Report

At the bottom of the Command page: a simple list of each agent and their total shift hours for the selected day (all showing `8h` on 30/03).

---

## Activity (`/#/activity`)

Page title: **Activity & Overtime** with two sub-tabs at the top right: `Activity Log` | `Overtime`.

### Activity Log tab

Full chronological audit trail. Each entry shows:
- Timestamp (UTC)
- Event type badge (color-coded):
  - `overtime-status-changed` — manager approved or denied an OT claim
  - `shift-claimed` — agent joined a coverage gap, claimed freed hours, or submitted/cancelled an OT opportunity claim
  - `break-updated` — agent added or removed their break
  - `shift-freed` — agent freed hours, making them "up for grabs"
- Plain-English description

**Actions available:** `Export` (download log) · `Clear log`

Sample events observed:
```
4/1/2026 2:36 PM UTC  overtime-status-changed  Manager denied Junior's overtime for 2026-04-01 shift (1.0h).
4/1/2026 2:33 PM UTC  shift-claimed            Junior joined line for 1.0h open-gap coverage on 2026-04-01.
4/1/2026 2:33 PM UTC  shift-claimed            Gabriel opened line for 1.0h open-gap coverage on 2026-04-01.
4/1/2026 10:47 AM UTC break-updated            Yoda removed their break on Wed 01/04.
3/31/2026 9:31 PM UTC shift-freed              Junior freed 1h of their Tue 31/03 shift. Now up for grabs.
```

### Overtime tab

Tabular view of all overtime records. Columns: `OPPORTUNITY`, `DATE`, `HOURS`, `ORIGIN`, `STATUS / CLAIMS`.

Status summary cards at top:
| Status | Count |
|---|---|
| PENDING | 0 |
| APPROVED | 0 |
| PAID | 0 |
| DENIED | 19 |

All 19 recorded OT entries were denied. Origin column shows either `gap HH:MM–HH:MM` (open-gap coverage) or `from <AgentName>` (freed-hour transfer). Each row has a dropdown to cycle status.

**Actions available:** `Export` · `Import` · `Clear log`

---

## Overtime (`/#/overtime`)

The sidebar `Overtime` link is a direct alias to the Activity & Overtime page with the Overtime tab pre-selected. Same view as above.

---

## Agents (`/#/profiles`)

Subtitle: **13 agents · global team**

Grid of agent cards (2 columns). Each card contains:
- Avatar (photo URL or colored initials fallback)
- Name + role (all "Support Agent")
- Timezone + current local time shown live
- Days-off toggle: `Day off at weekend` or `Day off at Thu/Fri`
- Weekly shift template: start time dropdown — end time dropdown
- `Apply week` button — pushes the template to every active day
- Per-day row showing each day's configured start time, with a ☕ break toggle on each

**Page-level actions:** `Export` · `Import` · `+ Add Agent`

### Agent roster (as of 2026-04-04)

| Agent | Timezone | Shift (UTC) | Days off |
|---|---|---|---|
| Gabriel | America/Sao_Paulo | 10:00–18:00 | Sat/Sun |
| Junior | America/Bogota | 15:00–23:00 | Thu/Fri |
| Enmanuel | America/Santo_Domingo | 15:00–23:00 | Sat/Sun |
| Yoda | Africa/Addis_Ababa | 14:00–22:00 | Thu/Fri |
| Melld | Africa/Casablanca | 08:00–16:00 | Thu/Fri |
| Jason | Europe/Zagreb | 07:00–15:00 | Thu/Fri |
| Jurica | Europe/Zagreb | 06:30–14:30 | Thu/Fri |
| Andrew | Africa/Johannesburg | 07:00–15:00 | Thu/Fri |
| Justine | — | 23:00–07:00 (+1) | — |
| Ned | — | 23:00–07:00 (+1) | — |
| Rachelle | — | 23:00–07:00 (+1) | — |
| Badiru | — | 14:00–22:00 | — |
| Russell | — | 23:00–07:00 (+1) | — |

### Edit Agent modal

Clicking the pencil icon on any card opens an edit dialog with:
- **Name** (text input)
- **Role** (text input)
- **Color** — color swatch picker (yellow, orange, red, pink, purple, cyan, teal, green)
- **Timezone** — dropdown (IANA tz names)
- **Avatar URL** (optional) — accepts a direct image URL; falls back to initials
- Live preview card showing how the agent will appear
- `Save Agent` button

---

## Global UI patterns

- **Sidebar** — persistent left nav with logo, four links, drag-scroll toggle, and a live `UTC NOW HH:MM:SS` clock
- **Dark theme** throughout — near-black background (#0f1117 range), yellow accent for manager actions
- **Drag scroll** — toggle in the bottom-left corner enables click-drag horizontal scrolling on the timeline
- **Notifications region** — keyboard shortcut `F8` mentioned in the a11y tree; toast/notification area exists
- **Footer** — "Built for distributed support operations."
- All times stored and displayed in **UTC**; agent local times shown as secondary info only

---

## Coverage mechanics observed

The system models three types of coverage events:
1. **Gap** — no agent scheduled; shows as red dashed on clock/COV row
2. **Up for grabs** — an agent freed hours from their shift; shown yellow dashed; other agents can claim
3. **Open-gap coverage** — a manager creates a coverage opportunity for a gap; agents can join the "line" (queue) to claim it; manager approves or denies

The Activity log confirmed the full flow:
```
shift-freed      → Junior freed 1h of their Tue 31/03 shift. Now up for grabs.
shift-claimed    → Jason claimed 1.0h freed from Junior's 2026-03-31 shift.
shift-claimed    → Gabriel submitted a claim for the 2026-04-04 overtime opportunity.
overtime-status-changed → Manager approved/denied Gabriel's claim.
```
