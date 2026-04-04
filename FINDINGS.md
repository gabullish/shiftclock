# ShiftClock — Live Bug & Flow Findings

Tested: 2026-04-04 ~20:00 UTC
Access: Manager
Method: Chrome DevTools MCP — live simulation of lever, break, overtime, reset, and apply-week flows

---

## Confirmed Bugs

### BUG-01 — Break survives outside shift window (data integrity)

**How to reproduce:**
1. Set a break on Gabriel (break placed at center of shift, e.g. 14:00 for 10:00–18:00)
2. Shrink the shift end past the break position using `← 30m` on end, until end = 14:00 or earlier
3. Then move the break forward with `☕ →`

**What happens:**
The break marker moves to 14:30 — outside the active shift window (10:00–14:00). The ☕ icon renders on the clock arc in the freed/up-for-grabs zone. The lever row still shows active `☕ ← ☕ →` and `Clear break` controls. No warning is shown.

**Activity log says:** `Gabriel set break at 13:30 UTC on Mon 30/03` — the intermediate move to 14:30 is not re-logged.

**Impact:** A break can exist at a time the agent isn't working. Coverage math may count the break hour as covered when it isn't. The break clock icon misleads managers reading the radial clock.

**Fix direction:** When shift end is shrunk past the break start, auto-clear the break and log `break-cleared: shift shrunk past break time`. Or block shrinking past the break with an inline warning.

---

### BUG-02 — Manager overtime extensions bypass the approval pipeline

**How to reproduce:**
1. Use `30m →` on the end lever to extend Gabriel past his 18:00 template end
2. Observe OVERTIME stat shows `+30m`
3. Go to Activity & Overtime → Overtime tab

**What happens:**
The activity log correctly logs `overtime-extended: Gabriel extended their Mon 30/03 shift by 30m`. But the Overtime table shows **0 PENDING** — no record was created. The extension goes live immediately with no approval step and no payroll trail.

**Contrast:** Agent-submitted claims (freed hours claimed by another agent) DO create pending OT records requiring manager approval. Manager lever extensions do not.

**Impact:** Hours worked beyond template are invisible to payroll. A manager can extend any agent any amount with no record in the approval pipeline. This is the most significant operational gap.

**Fix direction:** Any extension past the template end should create a PENDING overtime record, same as agent-submitted claims. The manager can then approve their own record or designate a secondary approver.

---

### BUG-03 — Reset day button is completely non-functional

**How to reproduce:**
1. Make any lever changes on a day (e.g. extend Gabriel, set a break)
2. Click "Reset day" button (tooltip: "Reset levers and pending OT for this day")

**What happens:**
Nothing. No confirmation dialog. No network request fired. No UI change. The button has an `onclick` handler registered but it executes silently without making any API call. Tested 3× including via direct JS `.click()` — confirmed 0 requests sent after button invocation.

**Impact:** Managers believe they have a recovery option after accidental lever changes or bad OT entries. That option doesn't work at all. Any lever change is permanent until manually reversed one click at a time.

**Fix direction:** Diagnose the onclick handler — likely a mutation or state reference issue. Should fire `POST /api/shifts/reset-day?date=...` or equivalent, then refetch. Add a confirmation dialog before executing since this is destructive.

---

### BUG-04 — Apply week fires immediately with no confirmation or preview

**How to reproduce:**
1. Go to Agents page
2. Click "Apply week" on any agent card

**What happens:**
Immediately POSTs to `/api/agents/:id/apply-week` with `{"startUtc": N, "endUtc": N}`. A toast briefly appears ("Week template applied"). No dialog, no preview, no warning about overwriting existing lever adjustments or breaks.

**Network payload observed:** `POST /api/agents/3/apply-week {"startUtc":15,"endUtc":23}`
The payload contains only start/end — no information about existing per-day customizations.

**Impact:** A manager editing templates and accidentally clicking "Apply week" silently overwrites all current lever adjustments for the entire week for that agent. Breaks on individual days are also wiped. There's no undo.

**Fix direction:** Add a confirmation dialog: "This will overwrite all shift adjustments and breaks for this week. Continue?" Alternatively, add an undo/preview step showing which days will change.

---

## Confirmed Behaviors (Not Bugs, But Worth Noting)

### BEHAVIOR-01 — Freed hours show correctly as "up for grabs", not as gaps

When shrinking a shift end, the freed segment renders as an orange dashed arc on the clock and the coverage report labels it clearly: `Gabriel 7h 30m · 30m up for grabs`. NO COVER stat stays 0h. This is correct.

### BEHAVIOR-02 — Break does not count against coverage

Setting a break does not increment NO COVER. Coverage report still shows full shift hours. The break is decorative/informational only from a coverage math perspective.

### BEHAVIOR-03 — Overtime lever extension re-absorbs freed hours silently

When shrinking creates freed hours, then extending back past the original end: the freed segment is silently consumed as the shift grows back, without a log entry for the reclaim. Only the final net state is logged. Multiple intermediate lever clicks produce only one activity entry.

### BEHAVIOR-04 — Activity log only logs final state per operation batch

Multiple rapid lever clicks (e.g. 5× `← 30m` end) produce one log entry reflecting the net change, not 5 entries. This is good for log cleanliness but means intermediate states are unrecoverable from the log.

---

## Partially Confirmed (Needs Agent Session to Fully Test)

### UNVERIFIED-01 — Claim path ambiguity in activity log

The analysis noted that both "freed hour claims" and "gap opportunity claims" use `shift-claimed` as the event type. Confirmed in the log — all entries are tagged `shift-claimed` regardless of path. The `ORIGIN` column in the Overtime tab differentiates (`from <Agent>` vs `gap HH:MM–HH:MM`), but the activity log has no such distinction. This makes auditing which path produced a given claim harder than it needs to be.

**Suggested fix:** Split into `shift-transfer-claimed` and `gap-coverage-claimed` event types, or add an `origin` field to the log entry text.

### UNVERIFIED-02 — Simultaneous claim race condition

Cannot test with a single manager session. Requires two agents claiming the same freed hour concurrently. The queue model for gap-coverage handles sequencing, but freed-hour direct claims (path 1) may be first-come-first-served with no race protection at the DB layer.

---

## Summary Table

| ID | Issue | Severity | Status |
|---|---|---|---|
| BUG-01 | Break persists outside shift window | Medium | **Confirmed** |
| BUG-02 | Manager OT extensions skip approval pipeline | High | **Confirmed** |
| BUG-03 | Reset day button does nothing | High | **Confirmed** |
| BUG-04 | Apply week overwrites without confirmation | Medium | **Confirmed** |
| BEHAVIOR-01 | Freed hours render correctly | — | Working as intended |
| BEHAVIOR-02 | Break doesn't affect coverage math | — | Working as intended |
| BEHAVIOR-03 | Freed hours silently reclaimed on re-extend | Low | Needs log entry |
| UNVERIFIED-01 | `shift-claimed` event type ambiguity | Low | Needs log audit |
| UNVERIFIED-02 | Simultaneous claim race condition | Unknown | Needs 2-agent test |
