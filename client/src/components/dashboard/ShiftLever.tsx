// Per-agent shift lever row — draggable start/end bar with break controls and
// a waive-prompt that intercepts attempts to collapse a shift below 1h.
import { useState, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { Agent, Shift } from "@shared/schema";
import {
  clampShiftWindow,
  resolveShift,
  shiftProgress,
  formatUtcHour,
  formatDuration,
  normaliseEndUtc,
  MAX_LEVER_DRIFT_HOURS,
  MIN_SHIFT_DURATION_HOURS,
  MAX_OT_EXTENSION_HOURS,
  WAIVE_PROMPT_THRESHOLD_HOURS,
} from "@/lib/shiftUtils";
import { getUTCDay, type LeverState } from "@/lib/dashboardUtils";

// Width of the virtual 48h bar (hours). Shifts can start before midnight so
// the bar covers a full two-day window to allow overnight/early-AM shifts.
const BAR_MAX = 48;

export function ShiftLever({
  agent, shift, leverState, onLeverPreview, onLeverCommit,
  onBreakChange, highlighted, onHighlight, onUnhighlight,
  baseHours: _baseHours, overtimeHours: _overtimeHours, releasedHours: _releasedHours,
  canEdit, utcHour, selectedDay,
  playSoftClick, playDragWhoosh,
}: {
  agent: Agent;
  shift: Shift | undefined;
  leverState: LeverState | undefined;
  onLeverPreview: (id: number, start: number, end: number) => void;
  onLeverCommit: (id: number, start: number, end: number) => void;
  onBreakChange: (id: number, breakStart: number | null) => void;
  highlighted: boolean;
  onHighlight: () => void;
  onUnhighlight: () => void;
  baseHours: number;
  overtimeHours: number;
  releasedHours: number;
  canEdit: boolean;
  utcHour: number;
  selectedDay: number;
  playSoftClick: () => void;
  playDragWhoosh: () => void;
}) {
  if (!shift || !leverState) return null;

  const { startUtc, endUtc }     = shift;
  const { activeStart, activeEnd } = leverState;
  const resolved  = resolveShift(startUtc, endUtc, activeStart, activeEnd, shift.breakStart ?? null);
  const isToday   = selectedDay === getUTCDay();
  const { pct, otPct } = isToday
    ? shiftProgress(startUtc, endUtc, activeStart, activeEnd, utcHour)
    : { pct: 0, otPct: 0 };

  const normEnd        = normaliseEndUtc(startUtc, endUtc);
  const baseLeft       = (startUtc    / BAR_MAX) * 100;
  const baseWidth      = (resolved.baseDuration / BAR_MAX) * 100;
  const actLeft        = (activeStart / BAR_MAX) * 100;
  const actWidth       = (resolved.activeDuration / BAR_MAX) * 100;
  const otCap          = normEnd + MAX_OT_EXTENSION_HOURS;
  const hitOTCap       = activeEnd   >= otCap;
  const hitDriftFloor  = activeStart <= startUtc - MAX_LEVER_DRIFT_HOURS;
  const baseDuration   = normEnd - startUtc;
  // Combined duration cap — prevents stacking both lever ends to their individual maxes simultaneously
  const maxTotalActive = baseDuration + MAX_OT_EXTENSION_HOURS;

  const [showWaivePrompt, setShowWaivePrompt] = useState(false);

  const applyGuards = (start: number, end: number) => {
    const guardedStart       = Math.max(startUtc - MAX_LEVER_DRIFT_HOURS, start);
    const guardedEnd         = Math.min(otCap, Math.max(guardedStart + MIN_SHIFT_DURATION_HOURS, end));
    const durationCappedEnd  = Math.min(guardedEnd, guardedStart + maxTotalActive);
    const finalEnd           = Math.max(guardedStart + MIN_SHIFT_DURATION_HOURS, durationCappedEnd);
    return clampShiftWindow(guardedStart, finalEnd);
  };

  const commitWindow = (start: number, end: number) => {
    const next = applyGuards(start, end);
    onLeverPreview(shift.id, next.activeStart, next.activeEnd);
    onLeverCommit(shift.id, next.activeStart, next.activeEnd);
  };

  const adjustEnd = (delta: number) => {
    if (!canEdit) return;
    const proposed = activeEnd + delta;
    if (proposed - activeStart < WAIVE_PROMPT_THRESHOLD_HOURS) {
      setShowWaivePrompt(true); // intercept — show waive prompt instead of committing
      return;
    }
    setShowWaivePrompt(false);
    commitWindow(activeStart, proposed);
  };

  const adjustStart = (delta: number) => {
    if (!canEdit) return;
    commitWindow(activeStart + delta, activeEnd);
  };

  const setBreakAt = (nextBreak: number | null) => {
    if (!canEdit) return;
    if (nextBreak == null) { onBreakChange(shift.id, null); return; }
    const min     = activeStart;
    const max     = activeEnd - 0.5;
    if (max < min) return;
    const snapped = Math.round(nextBreak * 2) / 2;
    onBreakChange(shift.id, Math.max(min, Math.min(max, snapped)));
  };

  const moveBreakBy    = (delta: number) => { if (shift.breakStart != null) setBreakAt(shift.breakStart + delta); };
  const setBreakDefault = () => {
    const duration = Math.max(0.5, activeEnd - activeStart);
    setBreakAt(activeStart + Math.max(0, (duration - 0.5) / 2));
  };

  // ── Drag-to-resize bar ──────────────────────────────────────────────────────
  const barRef  = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    type: "start" | "end" | "move";
    startX: number; startVal: number; startEnd: number;
    currentStart: number; currentEnd: number;
  } | null>(null);

  const onMouseDown = (e: React.MouseEvent, type: "start" | "end" | "move") => {
    if (!canEdit) return;
    e.preventDefault();
    playDragWhoosh();
    dragging.current = { type, startX: e.clientX, startVal: activeStart, startEnd: activeEnd, currentStart: activeStart, currentEnd: activeEnd };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !barRef.current) return;
      const rect  = barRef.current.getBoundingClientRect();
      const delta = ((ev.clientX - dragging.current.startX) / rect.width) * BAR_MAX;
      const { type: t, startVal, startEnd } = dragging.current;
      let next;
      if (t === "start") {
        next = applyGuards(startVal + delta, startEnd);
      } else if (t === "end") {
        // Waive prompt is for button clicks only — drag enforces 1h floor silently
        next = applyGuards(startVal, Math.max(startVal + WAIVE_PROMPT_THRESHOLD_HOURS, startEnd + delta));
      } else {
        const dur = startEnd - startVal;
        next = applyGuards(startVal + delta, startVal + delta + dur);
      }
      dragging.current.currentStart = next.activeStart;
      dragging.current.currentEnd   = next.activeEnd;
      onLeverPreview(shift.id, next.activeStart, next.activeEnd);
    };

    const onUp = () => {
      if (dragging.current) onLeverCommit(shift.id, dragging.current.currentStart, dragging.current.currentEnd);
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={cn("p-2.5 rounded-lg border transition-all duration-150")}
      style={{
        borderColor: highlighted ? agent.color + "60" : "hsl(var(--border))",
        backgroundColor: highlighted ? agent.color + "08" : undefined,
      }}
      onMouseEnter={onHighlight} onMouseLeave={onUnhighlight}
      data-testid={`lever-agent-${agent.id}`}
    >
      {/* ── Header row ── */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
          <span className="text-xs font-medium truncate max-w-[80px]">{agent.name}</span>
          {isToday && pct > 0 && (
            <span className="text-[11px] px-1 py-0.5 rounded font-mono font-bold"
              style={{ backgroundColor: agent.color + "25", color: agent.color }}>{pct}%</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {resolved.hasOvertime && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium"
              style={{ background: agent.color + "30", color: agent.color }}>
              +{formatDuration(resolved.overtimeHours)} OT
              {isToday && otPct > 0 && <span className="ml-1 opacity-70">{otPct}%</span>}
            </span>
          )}
          {resolved.hasShrink && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium bg-orange-500/20 text-orange-400">
              -{formatDuration(resolved.shrinkHours)} free
            </span>
          )}
          {shift.breakStart != null && (() => {
            const isOnBreak   = Boolean(agent.breakActiveAt);
            const elapsed     = isOnBreak && agent.breakActiveAt
              ? Math.floor((Date.now() - Date.parse(agent.breakActiveAt)) / 60000)
              : null;
            const isBreakSoon = !isOnBreak && utcHour >= shift.breakStart - 0.25 && utcHour < shift.breakStart + 0.5;
            const label = isOnBreak
              ? `☕ on break${elapsed !== null ? ` ${elapsed}m` : ""}`
              : isBreakSoon ? `☕ ${formatUtcHour(shift.breakStart)} soon`
              : `☕ ${formatUtcHour(shift.breakStart)}`;
            return (
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-sm font-medium transition-all duration-300",
                isOnBreak    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50"
                : isBreakSoon ? "bg-amber-500/15 text-amber-400 animate-pulse"
                : "bg-muted text-muted-foreground"
              )} title={`Break at ${formatUtcHour(shift.breakStart)} UTC`}>{label}</span>
            );
          })()}
        </div>
      </div>

      {/* ── Progress bar (today only) ── */}
      {isToday && pct > 0 && (
        <div className="mb-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(100, pct)}%`, backgroundColor: agent.color, opacity: 0.7 }} />
        </div>
      )}

      {activeStart < 0 && (
        <div className="mb-1 flex items-center gap-1 text-xs text-amber-400">
          <ChevronLeft className="h-3 w-3" />
          <span>+{formatDuration(-activeStart)} prev day</span>
        </div>
      )}

      {/* ── Drag bar ── */}
      <div ref={barRef} className="relative h-5 bg-muted rounded-sm overflow-hidden mb-2 select-none">
        <div className="absolute h-full rounded-sm opacity-20"
          style={{ left: `${baseLeft}%`, width: `${baseWidth}%`, backgroundColor: agent.color }} />
        {activeStart > startUtc && (
          <div className="absolute h-3 top-1 rounded-sm" style={{
            left: `${(startUtc / BAR_MAX) * 100}%`,
            width: `${((activeStart - startUtc) / BAR_MAX) * 100}%`,
            background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.6) 0px,rgba(255,140,0,0.6) 3px,transparent 3px,transparent 6px)",
          }} />
        )}
        {activeEnd < normEnd && (
          <div className="absolute h-3 top-1 rounded-sm" style={{
            left: `${(activeEnd / BAR_MAX) * 100}%`,
            width: `${((normEnd - activeEnd) / BAR_MAX) * 100}%`,
            background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.6) 0px,rgba(255,140,0,0.6) 3px,transparent 3px,transparent 6px)",
          }} />
        )}
        <div className="absolute h-full rounded-sm transition-none" style={{
          left: `${actLeft}%`,
          width: `${Math.max(1, Math.min(actWidth, resolved.hasOvertime ? actWidth : baseWidth))}%`,
          backgroundColor: agent.color,
          opacity: resolved.hasOvertime ? 0.9 : resolved.hasShrink ? 0.55 : 0.75,
          boxShadow: resolved.hasOvertime ? `0 0 6px white, 0 0 10px ${agent.color}` : undefined,
          cursor: canEdit ? "grab" : "default",
        }} onMouseDown={e => onMouseDown(e, "move")} />
        {activeStart < startUtc && (
          <div className="absolute h-full rounded-sm" style={{
            left: `${(activeStart / BAR_MAX) * 100}%`,
            width: `${((startUtc - activeStart) / BAR_MAX) * 100}%`,
            backgroundColor: agent.color,
            boxShadow: `0 0 6px white, 0 0 10px ${agent.color}`,
          }} />
        )}
        {activeEnd > normEnd && (
          <div className="absolute h-full rounded-sm" style={{
            left: `${(normEnd / BAR_MAX) * 100}%`,
            width: `${((activeEnd - normEnd) / BAR_MAX) * 100}%`,
            backgroundColor: agent.color,
            boxShadow: `0 0 6px white, 0 0 10px ${agent.color}`,
          }} />
        )}
        {shift.breakStart != null && (
          <div className="absolute top-0 bottom-0 z-20 rounded-sm flex items-center justify-center"
            style={{
              left:  `${(shift.breakStart / BAR_MAX) * 100}%`,
              width: `${Math.max(1.5, (0.5 / BAR_MAX) * 100)}%`,
              backgroundColor: "rgba(255,255,255,0.92)",
            }}
            title={`Break: ${formatUtcHour(shift.breakStart)}–${formatUtcHour(shift.breakStart + 0.5)}`}
          >
            <span style={{ fontSize: 6, lineHeight: 1 }}>☕</span>
          </div>
        )}
        {canEdit && (
          <div className="absolute top-0 bottom-0 w-2 rounded-l-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `${actLeft}%` }}
            onMouseDown={e => onMouseDown(e, "start")} />
        )}
        {canEdit && (
          <div className="absolute top-0 bottom-0 w-2 rounded-r-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `calc(${actLeft}% + ${Math.max(1, actWidth)}% - 8px)` }}
            onMouseDown={e => onMouseDown(e, "end")} />
        )}
      </div>

      {/* ── Start/end controls ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {canEdit && <button onClick={() => { playSoftClick(); adjustStart(-0.5); }} className="text-[10px] px-2 py-1 min-h-[28px] rounded bg-muted hover:bg-accent transition-colors" title="Earlier start">← 30m</button>}
          {canEdit && <button onClick={() => { playSoftClick(); adjustStart(0.5); }}  className="text-[10px] px-2 py-1 min-h-[28px] rounded bg-muted hover:bg-accent transition-colors" title="Later start">30m →</button>}
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeStart)}</span>
          {hitDriftFloor && <span className="text-[9px] text-amber-400/80" title="Maximum 8h before shift start">max -8h</span>}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{formatDuration(resolved.activeDuration)}</span>
        <div className="flex items-center gap-1">
          {hitOTCap && <span className="text-[9px] text-amber-400/80" title="Maximum 2h past scheduled end">max +2h</span>}
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeEnd)}</span>
          {canEdit && <button onClick={() => { playSoftClick(); adjustEnd(-0.5); }} className="text-[10px] px-2 py-1 min-h-[28px] rounded bg-muted hover:bg-accent transition-colors" title="Earlier end">← 30m</button>}
          {canEdit && <button onClick={() => { playSoftClick(); adjustEnd(0.5); }}  className="text-[10px] px-2 py-1 min-h-[28px] rounded bg-muted hover:bg-accent transition-colors" title="Later end">30m →</button>}
        </div>
      </div>

      {/* ── Waive prompt (intercepts shrink-to-nothing) ── */}
      {showWaivePrompt && (
        <div className="mt-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-400/30 text-[10px]">
          <p className="text-amber-300 mb-0.5 leading-tight font-medium">Almost no shift left</p>
          <p className="text-muted-foreground mb-1.5 leading-tight">
            Waive = release hours for others to claim. Keep 30m = stay with minimal coverage.
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                commitWindow(activeStart, activeStart + MIN_SHIFT_DURATION_HOURS);
                setShowWaivePrompt(false);
                toast({ title: `${agent.name}'s shift waived`, description: "Freed hours are now up for grabs in the coverage view.", duration: 5000 });
              }}
              className="px-2 py-0.5 rounded bg-amber-500/25 text-amber-200 hover:bg-amber-500/40 transition-colors"
              title="Release hours — others can claim them"
            >Waive shift</button>
            <button
              onClick={() => { commitWindow(activeStart, activeStart + MIN_SHIFT_DURATION_HOURS); setShowWaivePrompt(false); }}
              className="px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent transition-colors"
              title="Stay for minimum 30m coverage"
            >Keep 30m</button>
            <button onClick={() => setShowWaivePrompt(false)} className="px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Break controls ── */}
      {canEdit && (
        <div className="mt-1.5 flex items-center gap-1 text-[9px]">
          {shift.breakStart == null ? (
            <button onClick={() => { playSoftClick(); setBreakDefault(); }} className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Set 30m break near center of current shift">☕ Set break</button>
          ) : (
            <>
              <button onClick={() => { playSoftClick(); moveBreakBy(-0.5); }} className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Move break earlier by 30m">☕ ←</button>
              <button onClick={() => { playSoftClick(); moveBreakBy(0.5);  }} className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Move break later by 30m">☕ →</button>
              <button onClick={() => { playSoftClick(); setBreakAt(null);  }} className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Clear break">Clear break</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
