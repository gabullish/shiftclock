// 24-hour SVG clock ring that renders one arc per agent per shift.
// Handles ghost arcs, break gaps, OT highlights, shrink/gap overlays,
// pending-claim dashes, and a live clock hand for today.
import { useRef } from "react";
import type { Agent, Shift, OvertimeLog } from "@shared/schema";
import {
  normaliseEndUtc, resolveShift, segmentShift, shiftProgress,
  shiftDuration, displayHour, formatUtcHour, formatDuration,
  shiftLabel, getActiveClaimForShift, isCoverageClaim, shiftHasOverride,
} from "@/lib/shiftUtils";
import { findGapRanges, getUTCDay, type LeverState, type TooltipInfo } from "@/lib/dashboardUtils";

// ── SVG geometry helpers (only used here) ────────────────────────────────────
function hourToAngle(hour: number) { return (hour / 24) * 360 - 90; }

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startHour: number, endHour: number) {
  const s = Math.max(0, Math.min(24, startHour));
  const e = Math.max(0, Math.min(24, endHour));
  if (s >= e) return "";
  const sa = hourToAngle(s), ea = hourToAngle(e);
  const p1 = polarToCartesian(cx, cy, r, sa);
  const p2 = polarToCartesian(cx, cy, r, ea);
  const largeArc = (e - s) > 12 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
}

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// ─────────────────────────────────────────────────────────────────────────────

export function ClockVisualizer({
  agents, shifts, isAdmin, agentSessionId, visible, highlighted, setHighlighted,
  leverState, utcHour, coverage, otRecords,
  tooltipInfo, setTooltipInfo, selectedDay, onAssignOvertime, onAssignGap, onOpenOvertime,
}: {
  agents: Agent[]; shifts: Shift[]; isAdmin: boolean; agentSessionId: number | null; visible: Set<number>;
  highlighted: number | null; setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>; utcHour: number;
  coverage: number[]; otRecords: OvertimeLog[];
  tooltipInfo: TooltipInfo | null; setTooltipInfo: (v: TooltipInfo | null) => void;
  selectedDay: number;
  onAssignOvertime: (shift: Shift, agent: Agent, freedHours: number, segStart?: number, segEnd?: number, segDayOffset?: number) => void;
  onAssignGap: (startUtc: number, endUtc: number) => void;
  onOpenOvertime: (record: OvertimeLog) => void;
}) {
  const canClaimCoverage = isAdmin || agentSessionId != null;
  const SIZE   = 360;
  const CX = SIZE / 2, CY = SIZE / 2;
  const BASE_R = 100;
  const RING_W = 10;
  const GAP    = 3;
  const HEAT_R = BASE_R + agents.length * (RING_W + GAP) + 10;
  const svgRef = useRef<SVGSVGElement>(null);

  const todayUTCDay = getUTCDay();
  const isToday     = selectedDay === todayUTCDay;
  const now         = new Date();
  const secAngle    = (now.getUTCSeconds() / 60) * 360 - 90;

  // Arcs near the 11–13 range clip against the legend overlay — exclude from hit targets
  const NON_HOVER_START = 11;
  const NON_HOVER_END   = 13;

  const interactiveParts = (start: number, end: number) => {
    if (end <= NON_HOVER_START || start >= NON_HOVER_END) return [{ start, end }];
    if (start >= NON_HOVER_START && end <= NON_HOVER_END) return [];
    if (start < NON_HOVER_START && end > NON_HOVER_END) {
      return [{ start, end: NON_HOVER_START }, { start: NON_HOVER_END, end }];
    }
    if (start < NON_HOVER_START) return [{ start, end: NON_HOVER_START }];
    return [{ start: NON_HOVER_END, end }];
  };

  const gapRanges = findGapRanges(coverage);

  return (
    <div className="relative flex items-center justify-center w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="overflow-visible"
        style={{ width: `min(${SIZE}px, 100%)`, height: "auto", filter: "drop-shadow(0 0 30px rgba(0,0,0,0.8))" }}
        onMouseLeave={() => { setHighlighted(null); setTooltipInfo(null); }}
      >
        <circle cx={CX} cy={CY} r={HEAT_R + 4} fill="none" stroke="hsl(224 14% 16%)" strokeWidth="1" opacity="0.6" />

        {/* ── Outer ring tick marks — 288 ticks (every 5 min), radiating outside boundary ring ── */}
        {Array.from({ length: 288 }, (_, i) => {
          const angle    = hourToAngle(i / 12);
          const isMajor  = i % 72 === 0;   // 6h: 00, 06, 12, 18
          const isHour   = i % 12 === 0;   // every 1h
          const isHalf   = i % 6 === 0;    // every 30min
          const innerR   = HEAT_R + 5;
          const outerR   = isMajor ? HEAT_R + 22 : isHour ? HEAT_R + 16 : isHalf ? HEAT_R + 12 : HEAT_R + 9;
          const color    = isMajor ? "hsl(51 100% 50%)" : isHour ? "rgba(255,255,255,0.60)" : isHalf ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)";
          const sw       = isMajor ? 1.5 : isHour ? 1.0 : isHalf ? 0.75 : 0.6;
          const p1 = polarToCartesian(CX, CY, innerR, angle);
          const p2 = polarToCartesian(CX, CY, outerR, angle);
          return <line key={`otick-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={sw} />;
        })}

        <circle cx={CX} cy={CY} r={BASE_R - 8} fill="hsl(224 18% 11%)" stroke="hsl(224 14% 22%)" strokeWidth="1.5" />

        {Array.from({ length: 48 }, (_, i) => {
          const h = i / 2;
          const angle = hourToAngle(h);
          const isFullHour = i % 2 === 0;
          const isMajor    = i % 12 === 0;
          const outer = BASE_R - 9;
          const inner = isMajor ? BASE_R - 20 : isFullHour ? BASE_R - 16 : BASE_R - 13;
          const p1 = polarToCartesian(CX, CY, outer, angle);
          const p2 = polarToCartesian(CX, CY, inner, angle);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={isMajor ? "hsl(51 100% 50%)" : isFullHour ? "hsl(0 0% 40%)" : "hsl(0 0% 22%)"}
              strokeWidth={isMajor ? 1.5 : isFullHour ? 0.75 : 0.5}
            />
          );
        })}

        {Array.from({ length: 24 }, (_, h) => {
          const isMajor = h % 6 === 0;
          const labelR  = BASE_R - (isMajor ? 30 : 26);
          const p = polarToCartesian(CX, CY, labelR, hourToAngle(h));
          return (
            <text key={h} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={isMajor ? 8 : 6}
              fill={isMajor ? "hsl(51 100% 50%)" : "hsl(0 0% 50%)"}
              fontFamily="Space Mono, monospace"
              fontWeight={isMajor ? "700" : "400"}
            >
              {h.toString().padStart(2, "00")}
            </text>
          );
        })}

        {Array.from({ length: 24 }, (_, h) => {
          const isMajor = h % 6 === 0;
          const labelR  = HEAT_R + (isMajor ? 30 : 27);
          const p = polarToCartesian(CX, CY, labelR, hourToAngle(h));
          return (
            <text key={`outer-${h}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={isMajor ? 8.5 : 6.5}
              fill={isMajor ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.45)"}
              fontFamily="Space Mono, monospace"
              fontWeight={isMajor ? "700" : "400"}
              style={{ pointerEvents: "none" }}
            >
              {h.toString().padStart(2, "0")}
            </text>
          );
        })}

        {/* Outer ring: white base full circle */}
        <circle
          cx={CX} cy={CY} r={HEAT_R}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={4}
        />

        {/* Outer ring: dashed red arcs over zero-coverage hours */}
        {gapRanges.map((gap, i) => {
          const d = describeArc(CX, CY, HEAT_R, gap.start, gap.end);
          if (!d) return null;
          // Dash length approximates per-hour segments along the arc circumference
          const arcLen = ((gap.end - gap.start) / 24) * 2 * Math.PI * HEAT_R;
          const dash = Math.min(6, arcLen / 3);
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="rgba(230,57,70,0.85)"
              strokeWidth={4}
              strokeLinecap="butt"
              strokeDasharray={`${dash} ${dash}`}
              style={{ cursor: canClaimCoverage ? "pointer" : "default" }}
              onClick={() => canClaimCoverage && onAssignGap(gap.start, gap.end)}
            />
          );
        })}

        {agents.map((agent, idx) => {
          const isVis  = visible.has(agent.id);
          const isHigh = highlighted === agent.id;
          const r      = BASE_R + idx * (RING_W + GAP);
          const alpha  = isVis ? (isHigh ? 1.0 : 0.72) : 0.10;
          const strokeW = isHigh ? RING_W + 2 : RING_W;

          return (
            <g key={agent.id}>
              <circle cx={CX} cy={CY} r={r} fill="none"
                stroke={hexToRgba(agent.color, 0.12)} strokeWidth={RING_W}
                style={{ pointerEvents: "none" }}
              />
              {shifts.filter(s => s.agentId === agent.id).map(shift => {
                const ls  = leverState[shift.id];
                const as_ = ls?.activeStart ?? shift.startUtc;
                const ae  = ls?.activeEnd   ?? normaliseEndUtc(shift.startUtc, shift.endUtc);
                const resolved = resolveShift(shift.startUtc, shift.endUtc, as_, ae, shift.breakStart ?? null);
                const activeClaimForShift = getActiveClaimForShift(shift, otRecords, selectedDay);
                const bk = resolved.breakStart;
                const showGhost = isVis && shiftHasOverride(shift.startUtc, shift.endUtc, as_, ae);
                const { pct, otPct } = isToday
                  ? shiftProgress(shift.startUtc, shift.endUtc, as_, ae, utcHour)
                  : { pct: 0, otPct: 0 };

                const baseSegs    = segmentShift(shift.startUtc, normaliseEndUtc(shift.startUtc, shift.endUtc));
                const activeSegs  = segmentShift(as_, ae);
                const normBaseEnd = normaliseEndUtc(shift.startUtc, shift.endUtc);

                return (
                  <g key={shift.id}>
                    {showGhost && baseSegs.map((seg, si) => (
                      <path key={`ghost-${si}`}
                        d={describeArc(CX, CY, r, seg.start, seg.end)}
                        fill="none" stroke={hexToRgba(agent.color, isVis ? 0.22 : 0.06)}
                        strokeWidth={RING_W}
                        style={{ pointerEvents: "none" }}
                      />
                    ))}
                    {baseSegs.flatMap((seg, si) =>
                      interactiveParts(seg.start, seg.end).map((part, pi) => (
                        <path key={`hit-${si}-${pi}`}
                          d={describeArc(CX, CY, r, part.start, part.end)}
                          fill="none" stroke="white" strokeWidth={RING_W + 6} strokeOpacity={0}
                          style={{ cursor: "pointer", pointerEvents: "stroke" }}
                          onMouseEnter={(e) => {
                            const rect = svgRef.current?.getBoundingClientRect();
                            setHighlighted(agent.id);
                            if (rect) setTooltipInfo({ agent, shift, x: e.clientX - rect.left, y: e.clientY - rect.top, pct, otPct });
                          }}
                          onMouseMove={(e) => {
                            const rect = svgRef.current?.getBoundingClientRect();
                            if (rect) setTooltipInfo({ agent, shift, x: e.clientX - rect.left, y: e.clientY - rect.top, pct, otPct });
                          }}
                          onMouseLeave={() => {
                            setTooltipInfo(null);
                            setHighlighted(null);
                          }}
                        />
                      ))
                    )}
                    {isVis && bk == null && activeSegs.map((seg, si) => {
                      const segEnd = resolved.hasOvertime ? seg.end : Math.min(seg.end, seg.dayOffset === 0 ? normBaseEnd : normBaseEnd - 24);
                      if (segEnd <= seg.start) return null;
                      return (
                        <path key={`active-${si}`}
                          d={describeArc(CX, CY, r, seg.start, segEnd)}
                          fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    })}
                    {isVis && bk != null && activeSegs.map((seg, si) => {
                      const bkEnd  = bk + 0.5;
                      const segEnd = resolved.hasOvertime ? seg.end : Math.min(seg.end, seg.dayOffset === 0 ? normBaseEnd : normBaseEnd - 24);
                      if (segEnd <= seg.start) return null;
                      const beforeEnd  = Math.min(bk, segEnd);
                      const afterStart = Math.min(bkEnd, segEnd);
                      return (
                        <g key={`bk-${si}`}>
                          {beforeEnd > seg.start && (
                            <path d={describeArc(CX, CY, r, seg.start, beforeEnd)}
                              fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                              style={{ pointerEvents: "none" }}
                            />
                          )}
                          {afterStart < segEnd && (
                            <path d={describeArc(CX, CY, r, afterStart, segEnd)}
                              fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                              style={{ pointerEvents: "none" }}
                            />
                          )}
                          <path d={describeArc(CX, CY, r, bk, Math.min(bkEnd, segEnd))}
                            fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={strokeW + 2}
                            style={{ pointerEvents: "none" }}
                          />
                          {(() => {
                            const p = polarToCartesian(CX, CY, r, hourToAngle(bk + 0.25));
                            return (
                              <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
                                fontSize="5" style={{ pointerEvents: "none", userSelect: "none" }}>
                                ☕
                              </text>
                            );
                          })()}
                          {[bk, bk + 0.5].map((pt, pi) => {
                            const p = polarToCartesian(CX, CY, r, hourToAngle(pt));
                            return <circle key={pi} cx={p.x} cy={p.y} r={1.5} fill={hexToRgba(agent.color, 0.7)} />;
                          })}
                        </g>
                      );
                    })}
                    {isVis && resolved.hasOvertime && (() => {
                      const otSegs = [
                        ...(as_ < shift.startUtc ? segmentShift(as_, shift.startUtc) : []),
                        ...(ae > normBaseEnd     ? segmentShift(normBaseEnd, ae)      : []),
                      ];
                      return otSegs.map((seg, si) => (
                        <path key={`ot-${si}`}
                          d={describeArc(CX, CY, r, seg.start, seg.end)}
                          fill="none" stroke={agent.color} strokeWidth={strokeW + 2}
                          strokeOpacity={isHigh ? 1 : 0.9}
                          style={{ filter: `drop-shadow(0 0 3px white) drop-shadow(0 0 6px ${agent.color})`, pointerEvents: "none" }}
                        />
                      ));
                    })()}
                    {isVis && resolved.hasShrink && !activeClaimForShift && (() => {
                      const shrinkSegs = [
                        ...(as_ > shift.startUtc ? segmentShift(shift.startUtc, as_) : []),
                        ...(ae < normBaseEnd     ? segmentShift(ae, normBaseEnd)      : []),
                      ];
                      return shrinkSegs.map((seg, si) => (
                        <path key={`shrink-${si}`}
                          d={describeArc(CX, CY, r, seg.start, seg.end)}
                          fill="none" stroke="rgba(255,140,0,0.85)"
                          strokeWidth={strokeW * 0.6} strokeDasharray="3 3"
                          style={{ cursor: canClaimCoverage ? "pointer" : "default" }}
                          onClick={() => canClaimCoverage && onAssignOvertime(shift, agent, seg.end - seg.start, seg.start, seg.end, seg.dayOffset)}
                        >
                          <title>{canClaimCoverage ? "Join line for this freed time" : "Freed segment"}</title>
                        </path>
                      ));
                    })()}
                    {isVis && activeClaimForShift && activeClaimForShift.status === "pending" && (() => {
                      const claimSegs = segmentShift(activeClaimForShift.coverStartUtc!, activeClaimForShift.coverEndUtc!);
                      return claimSegs.map((seg, si) => (
                        <path key={`pending-shrink-${si}`}
                          d={describeArc(CX, CY, r, seg.start, seg.end)}
                          fill="none" stroke="rgba(255,140,0,0.85)"
                          strokeWidth={strokeW * 0.6} strokeDasharray="3 3"
                          style={{ cursor: "pointer" }}
                          onClick={() => onOpenOvertime(activeClaimForShift)}
                        >
                          <title>{`Pending claim: ${formatDuration(activeClaimForShift.coverEndUtc! - activeClaimForShift.coverStartUtc!)} awaiting manager approval`}</title>
                        </path>
                      ));
                    })()}
                  </g>
                );
              })}

              {isVis && otRecords
                .filter(
                  (slot) =>
                    slot.agentId === agent.id &&
                    isCoverageClaim(slot) &&
                    (slot.status === "pending" || slot.status === "approved" || slot.status === "paid") &&
                    slot.dayOfWeek === selectedDay &&
                    slot.coverStartUtc != null &&
                    slot.coverEndUtc != null
                )
                .flatMap((slot) => {
                  const isPending = slot.status === "pending";
                  const segs = segmentShift(slot.coverStartUtc!, slot.coverEndUtc!);
                  return segs.map((seg, si) => (
                    <path
                      key={`cov-claim-${slot.id}-${si}`}
                      d={describeArc(CX, CY, r, seg.start, seg.end)}
                      fill="none"
                      stroke={hexToRgba(agent.color, isPending ? 0.65 : 0.96)}
                      strokeWidth={RING_W}
                      strokeDasharray={isPending ? "2 5" : "6 3"}
                      strokeLinecap={isPending ? "butt" : "round"}
                      style={{
                        filter: isPending
                          ? "none"
                          : `drop-shadow(0 0 4px ${agent.color}) drop-shadow(0 0 8px ${agent.color}80)`,
                        pointerEvents: "auto",
                        cursor: "pointer",
                      }}
                      onClick={() => onOpenOvertime(slot)}
                    >
                      <title>{`${isPending ? "Pending coverage preview" : "Approved claimed coverage"}: ${formatUtcHour(slot.coverStartUtc!)}-${formatUtcHour(slot.coverEndUtc!)} UTC`}</title>
                    </path>
                  ));
                })}
            </g>
          );
        })}

        {/* Seconds hand — thin ghost line, only on today */}
        {isToday && (() => {
          const secTip  = polarToCartesian(CX, CY, HEAT_R + 14, secAngle);
          const secBase = polarToCartesian(CX, CY, 14, secAngle + 180);
          return (
            <line x1={secBase.x} y1={secBase.y} x2={secTip.x} y2={secTip.y}
              stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeLinecap="round"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}

        {/* UTC hour hand */}
        {(() => {
          const angle = hourToAngle(utcHour);
          const tip   = polarToCartesian(CX, CY, HEAT_R + 12, angle);
          const base  = polarToCartesian(CX, CY, 10, angle);
          return (
            <g style={{ pointerEvents: "none" }}>
              <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y}
                stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round" opacity="0.9"
              />
              <circle cx={tip.x} cy={tip.y} r={3} fill="hsl(51 100% 50%)" />
            </g>
          );
        })()}

        {/* Center hub */}
        <circle cx={CX} cy={CY} r={6} fill="hsl(51 100% 50%)" style={{ pointerEvents: "none" }} />
        <circle cx={CX} cy={CY} r={3} fill="hsl(224 16% 8%)" style={{ pointerEvents: "none" }} />

        {/* Per-agent progress % labels — today only */}
        {isToday && agents.map((agent, idx) => {
          const r = BASE_R + idx * (RING_W + GAP);
          const shift = shifts.find(s => s.agentId === agent.id);
          if (!shift || !visible.has(agent.id)) return null;
          const ls  = leverState[shift.id];
          const as_ = ls?.activeStart ?? shift.startUtc;
          const ae  = ls?.activeEnd   ?? normaliseEndUtc(shift.startUtc, shift.endUtc);
          const { pct } = shiftProgress(shift.startUtc, shift.endUtc, as_, ae, utcHour);
          if (pct <= 0 || pct > 100) return null;
          const midH = as_ + (pct / 100) * shiftDuration(shift.startUtc, normaliseEndUtc(shift.startUtc, shift.endUtc)) / 2;
          const p = polarToCartesian(CX, CY, r, hourToAngle(displayHour(midH)));
          return (
            <text key={agent.id} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fontSize="6.5" fill="white" fontWeight="800"
              style={{ pointerEvents: "none", textShadow: `0 0 3px ${agent.color}` }}
            >
              {pct}%
            </text>
          );
        })}
      </svg>

      {tooltipInfo && (
        <div
          className="absolute pointer-events-none z-50 px-2.5 py-1.5 rounded-md bg-card border border-border shadow-lg text-xs"
          style={{ left: tooltipInfo.x + 14, top: tooltipInfo.y - 10 }}
        >
          <div className="flex items-center gap-1.5 font-medium" style={{ color: tooltipInfo.agent.color }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tooltipInfo.agent.color }} />
            {tooltipInfo.agent.name}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {shiftLabel(tooltipInfo.shift.startUtc, tooltipInfo.shift.endUtc)}
          </div>
          <div className="text-muted-foreground text-[10px]">
            {formatDuration(shiftDuration(tooltipInfo.shift.startUtc, normaliseEndUtc(tooltipInfo.shift.startUtc, tooltipInfo.shift.endUtc)))} shift
          </div>
          {tooltipInfo.pct > 0 && (
            <div className="mt-1 pt-1 border-t border-border">
              <div className="flex items-center gap-1.5 text-[10px]">
                <div className="h-1 rounded-full flex-1 bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, tooltipInfo.pct)}%`, backgroundColor: tooltipInfo.agent.color }}
                  />
                </div>
                <span style={{ color: tooltipInfo.agent.color }} className="font-mono font-bold text-xs">{tooltipInfo.pct}%</span>
              </div>
              {tooltipInfo.otPct > 0 && (
                <div className="text-[9px] mt-0.5" style={{ color: tooltipInfo.agent.color }}>
                  OT: {tooltipInfo.otPct}% complete
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend overlay */}
      <div className="absolute top-0 right-0 flex flex-col gap-1.5 bg-card/80 rounded-lg p-2 border border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1" style={{ backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2 }} />
          <span className="text-[9px] text-muted-foreground">Covered</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: "rgba(230,57,70,0.85)" }} />
          <span className="text-[9px] text-muted-foreground">Gap</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: "rgba(255,140,0,0.9)" }} />
          <span className="text-[9px] text-muted-foreground">Up for grabs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: "rgba(255,255,255,0.96)" }} />
          <span className="text-[9px] text-muted-foreground">Claim / preview</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-full bg-white" style={{ boxShadow: "0 0 5px white, 0 0 8px rgba(255,255,255,0.6)" }} />
          <span className="text-[9px] text-muted-foreground">Overtime</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-1.5 rounded-full bg-white flex items-center justify-center" style={{ fontSize: 5 }}>☕</div>
          <span className="text-[9px] text-muted-foreground">Break</span>
        </div>
      </div>
    </div>
  );
}
