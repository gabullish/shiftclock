/**
 * shiftUtils.ts — Phase 1: Data Layer
 *
 * Single source of truth for all shift math across the app.
 * Handles overnight shifts (endUtc > 24), cross-day segmentation,
 * coverage calculation, break/OT/shrink metadata, and % elapsed.
 */

import type { OvertimeLog, Shift } from "@shared/schema";

export function isCoverageClaim(record: Pick<OvertimeLog, "origin">): boolean {
  return record.origin === "claimed-from-agent" || record.origin === "claimed-open-gap";
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A contiguous segment of a shift within a single calendar day. */
export interface ShiftSegment {
  /** Day offset from the shift's base day. 0 = same day, 1 = next day. */
  dayOffset: 0 | 1;
  /** Start hour within that day, 0–24. */
  start: number;
  /** End hour within that day, 0–24. */
  end: number;
  /** Whether this segment is the tail of an overnight shift (dayOffset === 1). */
  isOverflow: boolean;
}

/** Resolved active state for a shift (after lever adjustments). */
export interface ResolvedShift {
  startUtc: number;
  endUtc: number;
  activeStart: number;
  activeEnd: number;
  breakStart: number | null;
  /** Duration in hours of the base scheduled shift. */
  baseDuration: number;
  /** Duration in hours of the active (lever-adjusted) shift. */
  activeDuration: number;
  hasOvertime: boolean;
  hasShrink: boolean;
  overtimeHours: number;
  shrinkHours: number;
}

/** Break metadata for a resolved shift. */
export interface BreakInfo {
  /** UTC hour the break starts. */
  start: number;
  /** UTC hour the break ends (always start + 0.5). */
  end: number;
  /** Whether the break timing is suboptimal (first or last hour of shift). */
  isBadTiming: boolean;
}

/** Result of shiftPercent — progress through the shift. */
export interface ShiftProgress {
  /** 0–100: how far through the base shift window. */
  pct: number;
  /** 0–100: how far through the overtime portion (0 if no OT). */
  otPct: number;
}

export const MIN_SHIFT_DURATION_HOURS = 0.5;
export const MAX_SHIFT_SPAN_HOURS = 24;

// ─── Core duration ────────────────────────────────────────────────────────────

/**
 * Returns the duration in hours between startUtc and endUtc.
 * Handles both same-day (end > start) and overnight (endUtc > 24 or end < start).
 */
export function shiftDuration(startUtc: number, endUtc: number): number {
  if (endUtc > startUtc) return endUtc - startUtc;
  // Stored as raw hours e.g. 23→31 (next-day 07:00) — duration is straightforward
  // But if stored as 23→7 (legacy wrap), handle wrap
  return 24 - startUtc + endUtc;
}

/**
 * Normalises a raw endUtc so overnight shifts are always stored as endUtc > 24.
 * e.g. start=23, end=7  → end becomes 31
 *      start=9,  end=17 → unchanged (17)
 */
export function normaliseEndUtc(startUtc: number, endUtc: number): number {
  if (endUtc < startUtc) return endUtc + 24;
  return endUtc;
}

/**
 * Returns the "display" end hour (0–23.99) for rendering labels.
 * e.g. 31 → 7, 17 → 17
 */
export function displayHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

function snapHalfHour(hour: number): number {
  return Math.round(hour * 2) / 2;
}

export function clampShiftWindow(startUtc: number, endUtc: number): { activeStart: number; activeEnd: number } {
  const activeStart = snapHalfHour(Math.max(0, Math.min(24, startUtc)));
  const maxEnd = Math.min(48, activeStart + MAX_SHIFT_SPAN_HOURS);
  const activeEnd = snapHalfHour(
    Math.max(activeStart + MIN_SHIFT_DURATION_HOURS, Math.min(maxEnd, endUtc))
  );

  return { activeStart, activeEnd };
}

export function shiftHasOverride(
  startUtc: number,
  endUtc: number,
  activeStart: number,
  activeEnd: number
): boolean {
  const normEnd = normaliseEndUtc(startUtc, endUtc);
  return activeStart !== startUtc || activeEnd !== normEnd;
}

// ─── Segmentation ─────────────────────────────────────────────────────────────

/**
 * Splits a shift into 1 or 2 ShiftSegments for per-day rendering.
 *
 * Examples:
 *   09→17  → [{dayOffset:0, start:9,  end:17, isOverflow:false}]
 *   23→31  → [{dayOffset:0, start:23, end:24, isOverflow:false},
 *              {dayOffset:1, start:0,  end:7,  isOverflow:true}]
 *   23→7   → same as 23→31 (normalised internally)
 */
export function segmentShift(startUtc: number, rawEndUtc: number): ShiftSegment[] {
  const endUtc = normaliseEndUtc(startUtc, rawEndUtc);

  if (endUtc <= 24) {
    // Same-day shift
    return [{ dayOffset: 0, start: startUtc, end: endUtc, isOverflow: false }];
  }

  // Overnight: split at midnight
  return [
    { dayOffset: 0, start: startUtc, end: 24, isOverflow: false },
    { dayOffset: 1, start: 0,        end: endUtc - 24, isOverflow: true },
  ];
}

// ─── Resolve active shift ─────────────────────────────────────────────────────

/**
 * Merges a shift's scheduled times with its lever overrides into a
 * fully resolved ResolvedShift. Pass leverActiveStart/End as null
 * to use the scheduled values.
 */
export function resolveShift(
  startUtc: number,
  endUtc: number,
  leverActiveStart: number | null,
  leverActiveEnd: number | null,
  breakStart: number | null
): ResolvedShift {
  const normEnd      = normaliseEndUtc(startUtc, endUtc);
  const activeStart  = leverActiveStart  ?? startUtc;
  const activeEnd    = leverActiveEnd    ?? normEnd;
  const baseDuration = shiftDuration(startUtc, normEnd);
  const activeDuration = shiftDuration(activeStart, activeEnd);
  const hasOvertime  = activeDuration > baseDuration;
  const hasShrink    = activeDuration < baseDuration;

  return {
    startUtc,
    endUtc: normEnd,
    activeStart,
    activeEnd,
    breakStart,
    baseDuration,
    activeDuration,
    hasOvertime,
    hasShrink,
    overtimeHours:  hasOvertime ? activeDuration - baseDuration : 0,
    shrinkHours:    hasShrink   ? baseDuration - activeDuration : 0,
  };
}

// ─── Break helpers ────────────────────────────────────────────────────────────

/**
 * Returns structured BreakInfo for a shift, or null if no break is set.
 */
export function resolveBreak(
  breakStart: number | null,
  startUtc: number,
  endUtc: number
): BreakInfo | null {
  if (breakStart == null) return null;
  const normEnd = normaliseEndUtc(startUtc, endUtc);
  const dur     = shiftDuration(startUtc, normEnd);
  let rel       = breakStart - startUtc;
  if (rel < 0) rel += 24;
  const isBadTiming = rel < 1.0 || rel + 0.5 > dur - 1.0;
  return {
    start: breakStart,
    end:   breakStart + 0.5,
    isBadTiming,
  };
}

// ─── Progress / % elapsed ─────────────────────────────────────────────────────

/**
 * Returns shift progress percentages for "today" real-time rendering.
 * Returns {pct:0, otPct:0} if called for a non-current day.
 */
export function shiftProgress(
  startUtc: number,
  endUtc: number,
  activeStart: number,
  activeEnd: number,
  utcHour: number
): ShiftProgress {
  const normEnd      = normaliseEndUtc(startUtc, endUtc);
  const normActiveEnd = normaliseEndUtc(activeStart, activeEnd);
  const baseDur  = shiftDuration(startUtc, normEnd);
  const actDur   = shiftDuration(activeStart, normActiveEnd);
  if (baseDur <= 0) return { pct: 0, otPct: 0 };

  // Compute elapsed hours within the active window
  let elapsed = 0;
  const normHour = utcHour < activeStart && normActiveEnd > 24
    ? utcHour + 24  // we're in the next-day tail
    : utcHour;

  const normAS  = activeStart;
  const normAE  = normActiveEnd;

  if (normHour < normAS)       elapsed = 0;
  else if (normHour > normAE)  elapsed = actDur;
  else                          elapsed = normHour - normAS;

  const normalElapsed = Math.min(elapsed, baseDur);
  const otElapsed     = Math.max(0, elapsed - baseDur);
  const otTotal       = Math.max(0, actDur - baseDur);

  return {
    pct:   Math.round((normalElapsed / baseDur) * 100),
    otPct: otTotal > 0 ? Math.round((otElapsed / otTotal) * 100) : 0,
  };
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

/**
 * Computes per-hour (0–23) coverage count for a given day.
 * Each slot value = number of agents covering that hour.
 *
 * @param shiftsData  Array of {activeStart, activeEnd} resolved shifts
 */
export function calcCoverageForDay(
  shiftsData: Array<{ activeStart: number; activeEnd: number }>
): number[] {
  const slots = new Array<number>(24).fill(0);

  for (const { activeStart, activeEnd } of shiftsData) {
    const normEnd = normaliseEndUtc(activeStart, activeEnd);
    const segments = segmentShift(activeStart, normEnd);

    for (const seg of segments) {
      for (let h = Math.floor(seg.start); h < Math.ceil(seg.end); h++) {
        const slotH   = h % 24;
        const overlap = Math.min(seg.end, h + 1) - Math.max(seg.start, h);
        if (overlap > 0) slots[slotH] += overlap;
      }
    }
  }

  return slots;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format a UTC hour float as HH:MM */
export function formatUtcHour(h: number): string {
  const norm = displayHour(h);
  const totalMins = Math.round(norm * 60) % (24 * 60);
  const hh   = Math.floor(totalMins / 60);
  const mm   = totalMins % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

/** Format a duration in hours as "Xh Ym" */
export function formatDuration(hours: number): string {
  const totalMins = Math.round(hours * 60);
  if (totalMins <= 0) return "";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Returns "HH:MM – HH:MM" label with (+1) for overnight shifts */
export function shiftLabel(startUtc: number, endUtc: number): string {
  return `${formatUtcHour(startUtc)} – ${formatUtcHour(endUtc)}${
    normaliseEndUtc(startUtc, endUtc) > 24 ? " (+1)" : ""
  }`;
}

/**
 * Finds the latest active claim record for a source shift on a specific weekday.
 * Active statuses keep the released segment visible in UI.
 */
export function getActiveClaimForShift(
  shift: Pick<Shift, "id">,
  otRecords: OvertimeLog[],
  dayOfWeek?: number
): OvertimeLog | undefined {
  return otRecords
    .filter(
      (r) =>
        r.fromShiftId === shift.id &&
        isCoverageClaim(r) &&
        (r.status === "pending" || r.status === "approved" || r.status === "paid") &&
        (dayOfWeek == null || r.dayOfWeek === dayOfWeek) &&
        r.coverStartUtc != null &&
        r.coverEndUtc != null
    )
    .sort((a, b) => {
      const at = Date.parse(a.statusUpdatedAt || a.date || "") || 0;
      const bt = Date.parse(b.statusUpdatedAt || b.date || "") || 0;
      if (bt !== at) return bt - at;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0];
}
