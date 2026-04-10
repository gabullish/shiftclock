// Horizontal scrollable timeline — renders shifts, coverage bars, gap overlays,
// OT claims, and a live now-line. Supports two scopes:
//   "day"   — 24-hour view for the selected day
//   "multi" — 7-day rolling window (past 7 + future 6 days)
import { useState, useEffect, useRef, Fragment } from "react";
import { Clock } from "lucide-react";
import type { Agent, Shift, OvertimeLog } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import {
  normaliseEndUtc, resolveShift, segmentShift, shiftProgress,
  formatUtcHour, formatDuration, shiftLabel,
  isCoverageClaim, shiftHasOverride, getActiveClaimForShift,
  calcCoverageForDay,
} from "@/lib/shiftUtils";
import {
  findGapRanges, getUTCDay, buildDays, parseIsoDate,
  formatWeekdayLongWithDate, DAY_FULL, type LeverState,
} from "@/lib/dashboardUtils";

// Local colour helper — only used here and in ClockVisualizer
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function UnifiedTimeline({
  scope, agents, allShifts, otRecords, isAdmin, agentSessionId, visible, highlighted, setHighlighted,
  leverState, utcHour, selectedDay, selectedDate, focusHour, onSelectDay,
  toggleVisible, toggleAll, onAssignOvertime, onAssignGap, onOpenOvertime,
}: {
  scope: "day" | "multi";
  agents: Agent[];
  allShifts: Shift[];
  otRecords: OvertimeLog[];
  isAdmin: boolean;
  agentSessionId: number | null;
  visible: Set<number>;
  highlighted: number | null;
  setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>;
  utcHour: number;
  selectedDay: number;
  selectedDate: string;
  focusHour: number | null;
  onSelectDay: (dow: number, date?: string) => void;
  toggleVisible: (id: number) => void;
  toggleAll: () => void;
  onAssignOvertime: (shift: Shift, agent: Agent, freedHours: number, segStart?: number, segEnd?: number, segDayOffset?: number) => void;
  onAssignGap: (startUtc: number, endUtc: number, dayOfWeek?: number, date?: string) => void;
  onOpenOvertime: (record: OvertimeLog) => void;
}) {
  const canClaimCoverage = isAdmin || agentSessionId != null;
  const [winWidth, setWinWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const PX_PER_HOUR = winWidth < 768 ? 36 : winWidth < 1024 ? 46 : 56;
  const LABEL_W     = winWidth < 768 ? 80 : 120;
  const RULER_H     = 50;
  const COV_H       = 14;
  const ROW_H       = agents.length > 12 ? 28 : agents.length > 8 ? 32 : 38;

  const PAST_DAYS   = 7;
  const FUTURE_DAYS = 6;
  const days        = scope === "multi" ? buildDays(PAST_DAYS, FUTURE_DAYS, parseIsoDate(selectedDate)) : null;
  const todayIndex  = scope === "multi" ? (days?.findIndex((day) => day.isToday) ?? -1) : -1;
  const selectedIndex = scope === "multi" ? (days?.findIndex((day) => day.date === selectedDate) ?? -1) : -1;

  const TOTAL_HOURS = scope === "multi" ? (days!.length * 24) : 24;
  const CANVAS_W    = TOTAL_HOURS * PX_PER_HOUR;
  const CANVAS_H    = RULER_H + agents.length * (ROW_H + 2) + COV_H + 20;

  const { ref: scrollRef, onPointerDown, onPointerMove, onPointerUp, isDragging, stopDrag } = useDragScroll();
  const [barTooltip, setBarTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const hasAppliedDeepLinkFocus = useRef(false);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (hasAppliedDeepLinkFocus.current) return;

    if (scope === "multi" && focusHour != null && selectedDate) {
      const targetIndex = days?.findIndex((d) => d.date === selectedDate) ?? -1;
      if (targetIndex >= 0) {
        const focusPx = (targetIndex * 24 + focusHour) * PX_PER_HOUR;
        const w = scrollRef.current.clientWidth;
        scrollRef.current.scrollLeft = Math.max(0, focusPx - w / 2 + LABEL_W);
        hasAppliedDeepLinkFocus.current = true;
        return;
      }
    }

    if (scope === "multi") {
      const anchorIndex = todayIndex >= 0 ? todayIndex : Math.max(0, selectedIndex);
      const nowPx = (anchorIndex * 24 + utcHour) * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, nowPx - w / 2 + LABEL_W);
    } else {
      const nowPx = utcHour * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth - LABEL_W;
      if (nowPx > w * 0.6) {
        scrollRef.current.scrollLeft = Math.max(0, nowPx - w * 0.3);
      }
    }
    hasAppliedDeepLinkFocus.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, focusHour, selectedDate]);

  const scrollToNow = () => {
    if (!scrollRef.current) return;
    if (scope === "multi") {
      const anchorIndex = todayIndex >= 0 ? todayIndex : Math.max(0, selectedIndex);
      const nowPx = (anchorIndex * 24 + utcHour) * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth;
      scrollRef.current.scrollTo({ left: Math.max(0, nowPx - w / 2 + LABEL_W), behavior: "smooth" });
    } else {
      scrollRef.current.scrollTo({ left: Math.max(0, utcHour * PX_PER_HOUR - 80), behavior: "smooth" });
    }
  };

  const nowCanvasPx = scope === "multi"
    ? ((todayIndex >= 0 ? todayIndex : Math.max(0, selectedIndex)) * 24 + utcHour) * PX_PER_HOUR
    : utcHour * PX_PER_HOUR;

  const gridHours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

  const renderAgentRow = (agent: Agent, dayOffset: number, dayShifts: Shift[]) => {
    const isVis  = visible.has(agent.id);
    const isHigh = highlighted === agent.id;

    const agentShifts = dayShifts.filter(s => s.agentId === agent.id);
    const rowOffsetX  = dayOffset * 24 * PX_PER_HOUR;

    return agentShifts.map(shift => {
      const ls         = leverState[shift.id];
      const as_        = ls?.activeStart ?? shift.startUtc;
      const ae         = ls?.activeEnd   ?? normaliseEndUtc(shift.startUtc, shift.endUtc);
      const resolved   = resolveShift(shift.startUtc, shift.endUtc, as_, ae, shift.breakStart ?? null);
      const baseSegs   = segmentShift(shift.startUtc, normaliseEndUtc(shift.startUtc, shift.endUtc));
      const activeSegs = segmentShift(as_, ae);
      const normBaseEnd = normaliseEndUtc(shift.startUtc, shift.endUtc);
      const isOvernight = baseSegs.length > 1;
      const showGhost = isVis && shiftHasOverride(shift.startUtc, shift.endUtc, as_, ae);

      // For overnight shifts in multi-day scope:
      //   dayOfWeek = the labeled/operational day (where the bulk of hours fall)
      //   dayOffset:0 segment (e.g. 23:00-24:00) starts on the PREVIOUS calendar day
      //   dayOffset:1 segment (e.g. 00:00-07:00) is on the shift's own day (rowOffsetX)
      // No suppression: the pre-midnight segment always belongs to this shift,
      // even if the previous day is an off-day (e.g. Mon shift starts Sun 23:00)
      const segOffsetX = (seg: { dayOffset: number }) => {
        // dayOffset:-1 = lever pulled back into previous calendar day (negative activeStart)
        if (seg.dayOffset === -1) return scope === "day" ? rowOffsetX : rowOffsetX - 24 * PX_PER_HOUR;
        if (!isOvernight || scope === "day") return rowOffsetX;
        return seg.dayOffset === 0
          ? rowOffsetX - 24 * PX_PER_HOUR   // previous day column
          : rowOffsetX;                      // shift's own day column
      };

      // otPct unused in timeline view (shown in clock tooltip only), kept for API parity
      const { pct, otPct: _otPct } = scope === "day" && selectedDay === getUTCDay()
        ? shiftProgress(shift.startUtc, shift.endUtc, as_, ae, utcHour)
        : { pct: 0, otPct: 0 };
      const barLabel = `${agent.name}: ${shiftLabel(shift.startUtc, shift.endUtc)} · ${formatDuration(resolved.baseDuration)}`;

      // Check if there's a pending OT record claiming a portion of this shift
      const activeClaimForShift = getActiveClaimForShift(shift, otRecords, shift.dayOfWeek);

      return (
        <div key={shift.id} style={{ position: "absolute", inset: 0 }}>
          {showGhost && baseSegs.map((seg, si) => {
            const offX = segOffsetX(seg);
            return (
            <div key={`ghost-${si}`}
              style={{
                position: "absolute",
                left: offX + seg.start * PX_PER_HOUR,
                width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                top: 6, height: ROW_H - 12,
                backgroundColor: agent.color + (isVis ? "28" : "10"),
                border: `1px solid ${agent.color}${isVis ? "35" : "15"}`,
                borderRadius: 3,
              }}
            />
            );
          })}

          {/* Overnight connector: only show in day view where segments wrap */}
          {isOvernight && scope === "day" && (() => {
            const seg0 = baseSegs[0];
            const x1   = rowOffsetX + seg0.end * PX_PER_HOUR;
            const x2   = rowOffsetX + baseSegs[1].start * PX_PER_HOUR;
            if (Math.abs(x2 - x1) < 2) return null; // contiguous, no connector needed
            const midY = ROW_H / 2;
            return (
              <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: ROW_H, overflow: "visible", pointerEvents: "none" }}>
                <circle cx={x1} cy={midY} r={2.5} fill={agent.color} opacity={isVis ? 0.5 : 0.15} />
                <circle cx={x2} cy={midY} r={2.5} fill={agent.color} opacity={isVis ? 0.5 : 0.15} />
                <line x1={x1} y1={midY} x2={x2} y2={midY}
                  stroke={agent.color} strokeWidth={1} strokeDasharray="3 3" opacity={isVis ? 0.35 : 0.1} />
                <text x={x1 + 3} y={midY - 4} fontSize="7" fill={agent.color} opacity={isVis ? 0.7 : 0.2} fontFamily="monospace">+1</text>
              </svg>
            );
          })()}

          {isVis && activeSegs.map((seg, si) => {
            const segEnd = resolved.hasOvertime ? seg.end : Math.min(seg.end, seg.dayOffset === 0 ? normBaseEnd : normBaseEnd - 24);
            if (segEnd <= seg.start) return null;
            const offX = segOffsetX(seg);
            const barLeft = offX + seg.start * PX_PER_HOUR;
            const barW    = Math.max(2, (segEnd - seg.start) * PX_PER_HOUR);
            const showLabel = barW > 56;
            return (
              <div key={`active-${si}`}
                style={{
                  position: "absolute",
                  left: barLeft, width: barW,
                  top: 4, height: ROW_H - 8,
                  backgroundColor: agent.color,
                  opacity: isHigh ? 0.95 : 0.78,
                  borderRadius: 3,
                  boxShadow: isHigh ? `0 0 8px ${agent.color}60` : undefined,
                  cursor: "default",
                }}
                onPointerDownCapture={stopDrag}
                onMouseEnter={!showLabel ? (e) => {
                  const rect = scrollRef.current?.getBoundingClientRect();
                  if (rect) setBarTooltip({ text: barLabel, x: e.clientX - rect.left + scrollRef.current!.scrollLeft, y: e.clientY - rect.top });
                } : undefined}
                onMouseLeave={!showLabel ? () => setBarTooltip(null) : undefined}
              >
                {showLabel && (
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 6px", pointerEvents: "none", overflow: "hidden" }}>
                    <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", color: "white", mixBlendMode: "difference", opacity: 0.9 }}>
                      {formatUtcHour(shift.startUtc)}–{formatUtcHour(shift.endUtc)}
                      {pct > 0 && <span style={{ marginLeft: 4, opacity: 0.8 }}>{pct}%</span>}
                    </span>
                  </span>
                )}
              </div>
            );
          })}

          {resolved.breakStart != null && (() => {
            const bk  = resolved.breakStart;
            // Position break on correct day column for overnight shifts
            const bkDayOff = isOvernight && bk < shift.startUtc ? 1 : 0;
            const bkOffX = segOffsetX({ dayOffset: bkDayOff });
            const bkL = bkOffX + bk * PX_PER_HOUR;
            const bkW = Math.max(4, 0.5 * PX_PER_HOUR);
            return (
              <>
                <div style={{ position: "absolute", left: bkL, width: bkW, top: 2, height: ROW_H - 4, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 2, zIndex: 2 }} />
                <div style={{ position: "absolute", left: bkL + bkW / 2 - 5, top: 0, width: 10, height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, zIndex: 3, pointerEvents: "none" }}>☕</div>
              </>
            );
          })()}

          {isVis && resolved.hasOvertime && (() => {
            const otSegs = [
              ...(as_ < shift.startUtc ? segmentShift(as_, shift.startUtc) : []),
              ...(ae > normBaseEnd     ? segmentShift(normBaseEnd, ae)      : []),
            ];
            return otSegs.map((seg, si) => (
              <div key={`ot-${si}`}
                style={{
                  position: "absolute",
                  left: segOffsetX(seg) + seg.start * PX_PER_HOUR,
                  width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                  top: 2, height: ROW_H - 4,
                  backgroundColor: agent.color, opacity: 0.9, borderRadius: 3,
                  boxShadow: `0 0 4px white, 0 0 8px ${agent.color}`,
                }}
              />
            ));
          })()}

          {isVis && resolved.hasShrink && !activeClaimForShift && (() => {
            const shrinkSegs = [
              ...(as_ > shift.startUtc ? segmentShift(shift.startUtc, as_) : []),
              ...(ae < normBaseEnd     ? segmentShift(ae, normBaseEnd)      : []),
            ];
            return shrinkSegs.map((seg, si) => (
              <div key={`shrink-${si}`}
                onClick={() => canClaimCoverage && onAssignOvertime(shift, agent, seg.end - seg.start, seg.start, seg.end, seg.dayOffset)}
                onPointerDownCapture={stopDrag}
                title={canClaimCoverage ? "Join line for this freed time" : "Freed segment"}
                style={{
                  position: "absolute",
                  left: segOffsetX(seg) + seg.start * PX_PER_HOUR,
                  width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                  top: 8, height: ROW_H - 16, borderRadius: 2,
                  background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.7) 0px,rgba(255,140,0,0.7) 3px,transparent 3px,transparent 6px)",
                  border: "1px dashed rgba(255,140,0,0.6)",
                  cursor: canClaimCoverage ? "pointer" : "default",
                  zIndex: 10,
                }}
              />
            ));
          })()}

          {isVis && activeClaimForShift && (() => {
            const claimSegs = segmentShift(activeClaimForShift.coverStartUtc!, activeClaimForShift.coverEndUtc!);
            const isPending = activeClaimForShift.status === "pending";
            return claimSegs.map((seg, si) => (
              <div key={`pending-shrink-${si}`}
                onClick={() => onOpenOvertime(activeClaimForShift)}
                title={isPending
                  ? `Pending claim: ${formatDuration(activeClaimForShift.coverEndUtc! - activeClaimForShift.coverStartUtc!)} awaiting manager approval`
                  : `Claimed coverage: ${formatDuration(activeClaimForShift.coverEndUtc! - activeClaimForShift.coverStartUtc!)} (${activeClaimForShift.status})`}
                style={{
                  position: "absolute",
                  left: segOffsetX(seg) + seg.start * PX_PER_HOUR,
                  width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                  top: 8, height: ROW_H - 16, borderRadius: 2,
                  background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.7) 0px,rgba(255,140,0,0.7) 3px,transparent 3px,transparent 6px)",
                  border: isPending ? "1px dashed rgba(255,140,0,0.6)" : "1px dashed rgba(255,255,255,0.85)",
                  cursor: "pointer",
                  zIndex: 9,
                }}
              />
            ));
          })()}
        </div>
      );
    });
  };

  const renderCoverageBars = (agent: Agent, dayOffset: number, dayOfWeek: number) => {
    if (!visible.has(agent.id)) return null;
    // Show pending claims as preview and approved/paid claims as committed coverage.
    const coverageSlots = otRecords.filter(
      r => r.agentId === agent.id
        && isCoverageClaim(r)
        && (r.status === "pending" || r.status === "approved" || r.status === "paid")
        && r.dayOfWeek === dayOfWeek
        && r.coverStartUtc != null
        && r.coverEndUtc != null
    );
    if (coverageSlots.length === 0) return null;

    const rowOffsetX = dayOffset * 24 * PX_PER_HOUR;
    const coveredByAgent = (covByAgentId: number | null) =>
      agents.find(a => a.id === covByAgentId);

    return coverageSlots.map(slot => {
      const segs = segmentShift(slot.coverStartUtc!, slot.coverEndUtc!);
      const covAgent = coveredByAgent(slot.coveredByAgentId);
      const isOvernight = segs.length > 1;
      const isPending = slot.status === "pending";
      const sourceLabel = covAgent?.name ?? (slot.origin === "claimed-open-gap" ? "open gap" : "agent");

      const covSegOffsetX = (seg: { dayOffset: number }) => {
        if (!isOvernight || scope === "day") return rowOffsetX;
        return seg.dayOffset === 0
          ? rowOffsetX - 24 * PX_PER_HOUR
          : rowOffsetX;
      };

      return segs.map((seg, si) => (
        <div
          key={`cov-${slot.id}-${si}`}
          onClick={() => onOpenOvertime(slot)}
          title={`${isPending ? "Pending preview" : "Covering"} ${sourceLabel}: ${formatUtcHour(slot.coverStartUtc!)}–${formatUtcHour(slot.coverEndUtc!)} UTC`}
          style={{
            position: "absolute",
            left: covSegOffsetX(seg) + seg.start * PX_PER_HOUR,
            width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
            top: 4, height: ROW_H - 8,
            backgroundColor: isPending ? "transparent" : agent.color,
            opacity: isPending ? 0.75 : 0.85,
            borderRadius: 3,
            border: isPending ? `2px dashed ${hexToRgba(agent.color, 0.9)}` : `2px dashed white`,
            boxShadow: isPending ? "none" : `0 0 6px ${agent.color}80`,
            cursor: "pointer",
          }}
        >
          <span style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            padding: "0 4px", pointerEvents: "none", overflow: "hidden",
          }}>
            <span style={{
              fontSize: 8, fontFamily: "monospace", fontWeight: 700,
              whiteSpace: "nowrap", color: "white", mixBlendMode: "difference", opacity: 0.9,
            }}>
              {isPending ? "~" : "↗"} {sourceLabel} {formatUtcHour(slot.coverStartUtc!)}–{formatUtcHour(slot.coverEndUtc!)}
            </span>
          </span>
        </div>
      ));
    });
  };

  const renderCoverageStrip = (shiftsForDay: Shift[], dayOffsetPx: number, dayOfWeek: number) => {
    const covInput = shiftsForDay
      .filter(s => visible.has(s.agentId))
      .map(s => {
        const ls = leverState[s.id];
        return {
          activeStart: ls?.activeStart ?? s.startUtc,
          activeEnd:   ls?.activeEnd   ?? normaliseEndUtc(s.startUtc, s.endUtc),
        };
      })
      .concat(
        otRecords
          .filter(
            (slot) =>
              visible.has(slot.agentId) &&
              isCoverageClaim(slot) &&
              (slot.status === "approved" || slot.status === "paid") &&
              slot.dayOfWeek === dayOfWeek &&
              slot.coverStartUtc != null &&
              slot.coverEndUtc != null
          )
          .map((slot) => ({ activeStart: slot.coverStartUtc!, activeEnd: slot.coverEndUtc! }))
      );
    const cov    = calcCoverageForDay(covInput);
    const maxCov = Math.max(...cov, 1);
    return cov.map((c, h) => (
      <div key={`${dayOffsetPx}-${h}`}
        style={{
          position: "absolute",
          left: dayOffsetPx + h * PX_PER_HOUR,
          width: Math.max(1, PX_PER_HOUR - 1),
          top: 0, height: COV_H, borderRadius: 1,
          backgroundColor: c === 0
            ? "rgba(230,57,70,0.4)"
            : hexToRgba("#FFD700", 0.1 + (c / maxCov) * 0.55),
        }}
      />
    ));
  };

  const renderDayRuler = (offsetPx: number) => {
    const items: JSX.Element[] = [];
    for (let h = 0; h <= 24; h++) {
      const x       = offsetPx + h * PX_PER_HOUR;
      const isMajor = h % 6 === 0;
      items.push(
        <div key={`hr-${offsetPx}-${h}`} style={{ position: "absolute", left: x, top: 0, bottom: 0 }}>
          <div style={{
            position: "absolute",
            top: isMajor ? 0 : RULER_H - 10,
            bottom: 0, width: 1,
            backgroundColor: isMajor ? "hsl(var(--border))" : "hsl(var(--border) / 0.4)",
          }} />
          {h < 24 && (
            <span style={{
              position: "absolute", bottom: 3, left: 2,
              fontSize: 8, fontFamily: "monospace",
              color: isMajor ? "hsl(var(--primary) / 0.8)" : "hsl(var(--muted-foreground))",
              whiteSpace: "nowrap",
            }}>
              {h}h
            </span>
          )}
        </div>
      );
      if (h < 24) {
        for (let m = 1; m <= 11; m++) {
          const mx        = x + m * (PX_PER_HOUR / 12);
          const isHalf    = m === 6;
          const isQuarter = m === 3 || m === 9;
          const top   = isHalf ? RULER_H - 9 : isQuarter ? RULER_H - 6 : RULER_H - 3;
          const color = isHalf ? "rgba(255,255,255,0.35)" : isQuarter ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)";
          items.push(
            <div key={`min-${offsetPx}-${h}-${m}`} style={{
              position: "absolute",
              left: mx,
              top, bottom: 0, width: 1,
              backgroundColor: color,
            }} />
          );
        }
      }
    }
    return items;
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" onMouseLeave={() => setBarTooltip(null)}>
      {/* Sub-header: info + Now button + agent chips (day scope) */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 gap-3 min-h-0">
        <span className="text-[11px] text-muted-foreground shrink-0">
          {scope === "multi"
            ? `${days![0].dateLabel} — ${days![days!.length - 1].dateLabel} · UTC`
            : `${formatWeekdayLongWithDate(selectedDay, selectedDate)} · UTC`}
        </span>

        {/* Agent toggle chips — only in day timeline */}
        {scope === "day" && (
          <div className="flex items-center gap-1 flex-wrap overflow-hidden">
            <button onClick={toggleAll}
              className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all shrink-0">
              {visible.size === agents.length ? "Hide all" : "Show all"}
            </button>
            {agents.map(agent => (
              <button key={agent.id}
                onClick={() => toggleVisible(agent.id)}
                onMouseEnter={() => setHighlighted(agent.id)}
                onMouseLeave={() => setHighlighted(null)}
                data-testid={`toggle-agent-${agent.id}`}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border font-medium transition-all duration-150 shrink-0",
                  visible.has(agent.id) ? "opacity-100" : "opacity-40 grayscale"
                )}
                style={{
                  borderColor: agent.color + "60",
                  backgroundColor: visible.has(agent.id) ? agent.color + "20" : "transparent",
                  color: visible.has(agent.id) ? agent.color : "hsl(var(--muted-foreground))",
                  boxShadow: highlighted === agent.id ? `0 0 6px ${agent.color}50` : undefined,
                }}
              >
                {agent.name}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={scrollToNow}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all font-medium shrink-0"
        >
          <Clock size={11} /> Now
        </button>
      </div>

      {/* Scrollable canvas */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto overscroll-contain"
        style={{ scrollBehavior: "auto", cursor: isDragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div style={{ display: "flex", minWidth: CANVAS_W + LABEL_W, height: CANVAS_H, position: "relative" }}>

          {/* Sticky agent label column */}
          <div style={{
            position: "sticky", left: 0,
            width: LABEL_W, minWidth: LABEL_W, zIndex: 20,
            background: "hsl(var(--background))",
            borderRight: "1px solid hsl(var(--border))",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ height: RULER_H }} />
            {agents.map(agent => (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 px-2 cursor-pointer"
                style={{ height: ROW_H + 2, opacity: visible.has(agent.id) ? 1 : 0.3 }}
                onMouseEnter={() => setHighlighted(agent.id)}
                onMouseLeave={() => setHighlighted(null)}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                <span className="text-[10px] font-medium truncate" style={{ color: agent.color }}>{agent.name}</span>
              </div>
            ))}
            <div className="flex items-center px-2" style={{ height: COV_H + 8 }}>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Cov</span>
            </div>
          </div>

          {/* Canvas */}
          <div style={{ position: "relative", width: CANVAS_W, flexShrink: 0 }}>

            {/* Ruler */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: RULER_H, zIndex: 10, borderBottom: "1px solid hsl(var(--border) / 0.6)" }}>
              {scope === "day" ? (
                renderDayRuler(0)
              ) : (
                <>
                  {Array.from({ length: TOTAL_HOURS + 1 }, (_, h) => {
                    const x      = h * PX_PER_HOUR;
                    const localH = h % 24;
                    const isMid  = localH === 0;
                    const isEven = h % 2 === 0;
                    return (
                      <Fragment key={`mh-${h}`}>
                        {/* Hour tick */}
                        <div style={{ position: "absolute", left: x, top: 0, bottom: 0 }}>
                          <div style={{
                            position: "absolute",
                            top: isMid ? 0 : isEven ? RULER_H - 8 : RULER_H - 5,
                            bottom: 0, width: 1,
                            backgroundColor: isMid ? "hsl(var(--border))" : isEven ? "hsl(var(--border) / 0.4)" : "hsl(var(--border) / 0.2)",
                          }} />
                          {isEven && !isMid && (
                            <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, fontFamily: "monospace", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                              {localH.toString().padStart(2, "0")}
                            </span>
                          )}
                        </div>
                        {/* 30-min and 15-min sub-ticks */}
                        {h < TOTAL_HOURS && (
                          <>
                            <div style={{
                              position: "absolute", left: x + PX_PER_HOUR / 2,
                              top: RULER_H - 5, bottom: 0, width: 1,
                              backgroundColor: "rgba(255,255,255,0.28)",
                            }} />
                            <div style={{
                              position: "absolute", left: x + PX_PER_HOUR / 4,
                              top: RULER_H - 3, bottom: 0, width: 1,
                              backgroundColor: "rgba(255,255,255,0.15)",
                            }} />
                            <div style={{
                              position: "absolute", left: x + PX_PER_HOUR * 3 / 4,
                              top: RULER_H - 3, bottom: 0, width: 1,
                              backgroundColor: "rgba(255,255,255,0.15)",
                            }} />
                          </>
                        )}
                      </Fragment>
                    );
                  })}
                  {days!.map(day => {
                    const x         = day.dayIndex * 24 * PX_PER_HOUR;
                    const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6;
                    return (
                      <div
                        key={day.date}
                        onClick={() => {
                          const d = new Date(day.date + "T00:00:00Z");
                          onSelectDay(d.getUTCDay(), day.date);
                        }}
                        title={`Open ${DAY_FULL[day.dayOfWeek]} ${day.dateLabel} in Day view`}
                        style={{ position: "absolute", left: x + 4, top: 4, cursor: "pointer", userSelect: "none" }}
                      >
                        <span style={{
                          fontSize: day.isToday ? 11 : 10,
                          fontWeight: day.isToday ? 700 : 500,
                          color: day.isToday
                            ? "hsl(var(--primary))"
                            : isWeekend ? "hsl(var(--muted-foreground) / 0.5)"
                            : "hsl(var(--muted-foreground))",
                          fontFamily: "monospace",
                        }}>
                          {day.label} {day.dateLabel}
                        </span>
                        {day.isToday && (
                          <span style={{
                            display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                            backgroundColor: "hsl(var(--primary))", marginLeft: 4, verticalAlign: "middle",
                            animation: "pulse 2s infinite",
                          }} />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Current hour highlight */}
            {scope === "day" ? (
              <div style={{
                position: "absolute",
                left: Math.floor(utcHour) * PX_PER_HOUR,
                top: RULER_H, width: PX_PER_HOUR, bottom: 0,
                background: "rgba(255,215,0,0.04)",
                borderLeft: "1px solid rgba(255,215,0,0.12)",
                borderRight: "1px solid rgba(255,215,0,0.12)",
                pointerEvents: "none",
              }} />
            ) : (
              days!.map(day => {
                const x         = day.dayIndex * 24 * PX_PER_HOUR;
                const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6;
                return (
                  <div key={day.date} style={{
                    position: "absolute", left: x, top: RULER_H,
                    width: 24 * PX_PER_HOUR, bottom: 0,
                    backgroundColor: day.isToday
                      ? "rgba(255,215,0,0.03)"
                      : isWeekend ? "rgba(255,255,255,0.008)" : undefined,
                    borderLeft: day.dayIndex > 0 ? "1px solid hsl(var(--border) / 0.3)" : undefined,
                  }} />
                );
              })
            )}

            {/* Grid lines */}
            {scope === "day" ? (
              gridHours.map(h => (
                <div key={h} style={{
                  position: "absolute", left: h * PX_PER_HOUR,
                  top: RULER_H, bottom: 0, width: 1,
                  backgroundColor: "hsl(var(--border) / 0.4)", pointerEvents: "none",
                }} />
              ))
            ) : (
              Array.from({ length: TOTAL_HOURS + 1 }, (_, h) => {
                if (h % 24 === 0 || (h % 24 !== 0 && h % 2 !== 0)) return null;
                return (
                  <div key={h} style={{
                    position: "absolute", left: h * PX_PER_HOUR,
                    top: RULER_H, bottom: 0, width: 1,
                    backgroundColor: "hsl(var(--border) / 0.2)", pointerEvents: "none",
                  }} />
                );
              })
            )}

            {/* Agent rows */}
            {agents.map((agent, ai) => {
              const rowTop = RULER_H + ai * (ROW_H + 2);
              const isHigh = highlighted === agent.id;

              return (
                <div
                  key={agent.id}
                  style={{
                    position: "absolute", top: rowTop, left: 0, right: 0, height: ROW_H,
                    opacity: visible.has(agent.id) ? 1 : 0.2,
                    backgroundColor: isHigh ? agent.color + "08" : undefined,
                    borderRadius: 3,
                    transition: "background-color 0.1s",
                  }}
                  onMouseEnter={() => setHighlighted(agent.id)}
                  onMouseLeave={() => setHighlighted(null)}
                >
                  {scope === "day" ? (
                    <>
                      {renderAgentRow(agent, 0, allShifts.filter(s => s.dayOfWeek === selectedDay))}
                      {renderCoverageBars(agent, 0, selectedDay)}
                    </>
                  ) : (
                    days!.map(day => (
                      <div key={day.date} style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW_H }}>
                        {renderAgentRow(agent, day.dayIndex, allShifts.filter(s => s.dayOfWeek === day.dayOfWeek))}
                        {renderCoverageBars(agent, day.dayIndex, day.dayOfWeek)}
                      </div>
                    ))
                  )}
                </div>
              );
            })}

            {/* Coverage strip */}
            <div style={{
              position: "absolute",
              top: RULER_H + agents.length * (ROW_H + 2) + 4,
              left: 0, right: 0, height: COV_H,
            }}>
              {scope === "day"
                ? renderCoverageStrip(allShifts.filter(s => s.dayOfWeek === selectedDay), 0, selectedDay)
                : days!.map(day => renderCoverageStrip(allShifts.filter(s => s.dayOfWeek === day.dayOfWeek), day.dayIndex * 24 * PX_PER_HOUR, day.dayOfWeek))
              }
            </div>

            {/* Clickable gap overlays in day scope */}
            {scope === "day" && canClaimCoverage && findGapRanges(calcCoverageForDay(
              allShifts
                .filter(s => s.dayOfWeek === selectedDay && visible.has(s.agentId))
                .map(s => {
                  const ls = leverState[s.id];
                  return {
                    activeStart: ls?.activeStart ?? s.startUtc,
                    activeEnd: ls?.activeEnd ?? normaliseEndUtc(s.startUtc, s.endUtc),
                  };
                })
                .concat(
                  otRecords
                    .filter(r => visible.has(r.agentId) && isCoverageClaim(r) && (r.status === "approved" || r.status === "paid") && r.dayOfWeek === selectedDay && r.coverStartUtc != null && r.coverEndUtc != null)
                    .map((r) => ({ activeStart: r.coverStartUtc!, activeEnd: r.coverEndUtc! }))
                )
            )).map((gap) => (
              <button
                key={`timeline-gap-${gap.start}-${gap.end}`}
                onClick={() => onAssignGap(gap.start, gap.end, selectedDay, selectedDate)}
                style={{
                  position: "absolute",
                  left: gap.start * PX_PER_HOUR,
                  width: Math.max(2, (gap.end - gap.start) * PX_PER_HOUR),
                  top: RULER_H + agents.length * (ROW_H + 2) + 2,
                  height: COV_H + 4,
                  border: "1px dashed rgba(230,57,70,0.8)",
                  background: "rgba(230,57,70,0.08)",
                  borderRadius: 3,
                  zIndex: 12,
                  cursor: "pointer",
                }}
                title={`Join line for gap ${formatUtcHour(gap.start)}-${formatUtcHour(gap.end)} UTC`}
              />
            ))}

            {/* Now line */}
            {(scope === "day" || todayIndex >= 0) && (
              <div style={{
                position: "absolute", left: nowCanvasPx,
                top: 0, bottom: 0, width: 1,
                backgroundColor: "hsl(var(--primary))", opacity: 0.85,
                zIndex: 15, pointerEvents: "none",
              }}>
                <div style={{
                  position: "absolute", top: RULER_H - 6, left: -4,
                  width: 9, height: 9, borderRadius: "50%",
                  backgroundColor: "hsl(var(--primary))",
                }} />
              </div>
            )}

          </div>
        </div>
      </div>

      {barTooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-md bg-card border border-border shadow-lg text-xs whitespace-nowrap"
          style={{ left: barTooltip.x + 12, top: barTooltip.y - 32 }}
        >
          {barTooltip.text}
        </div>
      )}
    </div>
  );
}
