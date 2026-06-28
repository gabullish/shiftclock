// Shared types and pure utility functions used across Dashboard components.
// No React, no state, no side-effects — safe to import anywhere.
import type { Agent, Shift, Absence } from "@shared/schema";

/**
 * The absence covering `date` for `agentId`, if any. ISO YYYY-MM-DD compares
 * lexicographically (= chronologically), and the span is inclusive on both ends.
 */
export function activeAbsence(absences: Absence[], agentId: number, date: string): Absence | undefined {
  return absences.find(a => a.agentId === agentId && a.startDate <= date && date <= a.endDate);
}

// ─── Day/label arrays ────────────────────────────────────────────────────────

export const DAYS     = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LeverState { activeStart: number; activeEnd: number; }

export interface DayDesc {
  date: string;
  dayOfWeek: number;
  label: string;
  dateLabel: string;
  isToday: boolean;
  dayIndex: number;
}

export interface GapRange { start: number; end: number; }

export interface GapSlice { startUtc: number; endUtc: number; }

/** Whether a time slot is already over, happening now, or still upcoming. */
export type Tense = "past" | "now" | "future";

/**
 * Classifies a slot on `date` (hours startUtc..endUtc) relative to the live UTC
 * moment (`todayDate` + `utcHour`). Drives whether coverage is *claimed* (future/now,
 * goes through the approval line) or *logged retroactively* (past, recorded as done).
 */
export function classifySlotTense(
  date: string,
  startUtc: number,
  endUtc: number,
  todayDate: string,
  utcHour: number,
): Tense {
  if (date < todayDate) return "past";
  if (date > todayDate) return "future";
  if (endUtc <= utcHour) return "past";
  if (startUtc > utcHour) return "future";
  return "now";
}

export interface TooltipInfo {
  agent: Agent;
  shift: Shift;
  x: number;
  y: number;
  pct: number;
  otPct: number;
}

export type AgentSummary = {
  agent: Agent;
  baseHours: number;
  activeHours: number;
  overtimeHours: number;
  releasedHours: number;
  coveredOutHours: number;
  coveredByAgentId: number | null;
  shifts: Shift[];
  absenceType: string | null;
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the UTC Monday of the week containing `date`.
 */
function getMondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Returns true if `forDate` falls in a "working weekend" week for this agent.
 * offCycleStart: ISO date string (e.g. "2026-05-25") of the Monday of the
 * agent's first WEEKEND-working week. Even weeks from that anchor = weekend work,
 * odd weeks = M-F work. Falls back to offWeekend flag if no cycle start is set.
 */
export function isWeekendWorkWeek(
  offCycleStart: string | null | undefined,
  offWeekend: number | null | undefined,
  forDate: Date = new Date(),
): boolean {
  if (offCycleStart) {
    const anchor  = new Date(`${offCycleStart}T00:00:00Z`);
    const current = getMondayOf(forDate);
    const weeks   = Math.round((current.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return weeks % 2 === 0;
  }
  // Legacy fallback: offWeekend=0 means they work weekends (off Thu/Fri)
  return (offWeekend ?? 1) === 0;
}

/**
 * Returns the days-of-week ([0..6]) that `agent` has off for a given date.
 * 0=Sun, 1=Mon, …, 4=Thu, 5=Fri, 6=Sat
 */
export function getAgentOffDays(
  agent: { offWeekend: number | null; offCycleStart?: string | null },
  forDate: Date = new Date(),
): number[] {
  return isWeekendWorkWeek(agent.offCycleStart, agent.offWeekend, forDate)
    ? [4, 5]   // working weekend → Thu/Fri off
    : [0, 6];  // M-F week → Sat/Sun off
}

export function getUTCDay():  number { return new Date().getUTCDay(); }
export function getUTCHour(): number {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
}

export function parseIsoDate(date: string): Date {
  // Force UTC midnight so date math doesn't drift with local timezone offsets.
  return new Date(`${date}T00:00:00Z`);
}

export function formatDayMonth(value: Date | string): string {
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  return `${date.getUTCDate().toString().padStart(2, "0")}/${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

export function formatWeekdayWithDate(dayOfWeek: number, date: string): string {
  return `${DAYS[dayOfWeek]} ${formatDayMonth(date)}`;
}

export function formatWeekdayLongWithDate(dayOfWeek: number, date: string): string {
  return `${DAY_FULL[dayOfWeek]} ${formatDayMonth(date)}`;
}

export function resolveDateForWeekday(dayOfWeek: number, anchor = new Date()): string {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + (dayOfWeek - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

// ─── Day-range builders ────────────────────────────────────────────────────────

export function buildDays(pastDays: number, futureDays: number, anchor = new Date()): DayDesc[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const total    = pastDays + 1 + futureDays;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - pastDays + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dow     = d.getUTCDay();
    return {
      date: dateStr,
      dayOfWeek: dow,
      label: DAYS[dow],
      dateLabel: formatDayMonth(d),
      isToday: dateStr === todayStr,
      dayIndex: i,
    };
  });
}

export function buildWeekCycleDays(anchorDate: string): DayDesc[] {
  const anchor = parseIsoDate(anchorDate);
  const start  = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());

  const todayStr = new Date().toISOString().slice(0, 10);
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + dayIndex);
    const date      = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay();
    return {
      date,
      dayOfWeek,
      label: DAYS[dayOfWeek],
      dateLabel: formatDayMonth(d),
      isToday: date === todayStr,
      dayIndex,
    };
  });
}

// ─── Coverage gap helpers ─────────────────────────────────────────────────────

/** Finds contiguous hour ranges where coverage[hour] === 0. */
export function findGapRanges(coverage: number[]): GapRange[] {
  const ranges: GapRange[] = [];
  let start: number | null = null;
  for (let hour = 0; hour <= 24; hour++) {
    const isGap = hour < 24 && coverage[hour] === 0;
    if (isGap && start == null) start = hour;
    if (!isGap && start != null) {
      ranges.push({ start, end: hour });
      start = null;
    }
  }
  return ranges;
}

/** Expands contiguous gap ranges into individual 1-hour slices. */
export function expandGapRangesToSlices(ranges: GapRange[]): GapSlice[] {
  return ranges.flatMap(range => {
    const slices: GapSlice[] = [];
    for (let hour = range.start; hour < range.end; hour++) {
      slices.push({ startUtc: hour, endUtc: hour + 1 });
    }
    return slices;
  });
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}
