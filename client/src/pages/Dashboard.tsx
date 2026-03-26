import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RotateCcw, Clock, AlignLeft, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getUTCDay() { return new Date().getUTCDay(); }
function getUTCHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
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

function formatH(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60);
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

// ── Human-readable duration (e.g. 30m, 1h, 1h 30m, 8h) ─────────────────────
function fmtDuration(hours: number): string {
  const totalMins = Math.round(hours * 60); // rounds away float noise like 1.4e-15
  if (totalMins <= 0) return "";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Shift duration helper (handles overnight shifts where endUtc < startUtc) ──
function shiftDuration(startUtc: number, endUtc: number): number {
  return endUtc > startUtc ? endUtc - startUtc : 24 - startUtc + endUtc;
}

// ── Coverage calc ─────────────────────────────────────────────────────────────
function calcCoverage(
  agents: Agent[], shifts: Shift[], visible: Set<number>,
  leverState: Record<number, LeverState>
) {
  const slots = Array(24).fill(0);
  for (const agent of agents) {
    if (!visible.has(agent.id)) continue;
    for (const shift of shifts.filter(s => s.agentId === agent.id)) {
      const ls = leverState[shift.id];
      const start = ls?.activeStart ?? shift.startUtc;
      const end   = ls?.activeEnd   ?? shift.endUtc;
      // Handle overnight shifts (end < start means it wraps past midnight)
      if (end >= start) {
        for (let h = Math.floor(start); h < Math.ceil(end); h++) {
          const overlap = Math.min(end, h + 1) - Math.max(start, h);
          if (overlap > 0) slots[h % 24] += overlap;
        }
      } else {
        // From start to midnight
        for (let h = Math.floor(start); h < 24; h++) {
          const overlap = Math.min(24, h + 1) - Math.max(start, h);
          if (overlap > 0) slots[h] += overlap;
        }
        // From midnight to end
        for (let h = 0; h < Math.ceil(end); h++) {
          const overlap = Math.min(end, h + 1) - Math.max(0, h);
          if (overlap > 0) slots[h] += overlap;
        }
      }
    }
  }
  return slots;
}

interface LeverState { activeStart: number; activeEnd: number; }

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const isAdmin = useAdminMode();

  const initDay = () => {
    const d = getUTCDay();
    return (d === 0 || d === 6) ? 1 : d;
  };

  const [selectedDay, setSelectedDay] = useState<number>(initDay);
  const [visible, setVisible]         = useState<Set<number>>(new Set());
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [leverState, setLeverState]   = useState<Record<number, LeverState>>({});
  const [utcHour, setUtcHour]         = useState(getUTCHour());
  const [viewMode, setViewMode]       = useState<"clock" | "timeline">("clock");
  // Tooltip state for clock ring hover
  const [tooltipInfo, setTooltipInfo] = useState<{ agent: Agent; shift: Shift; x: number; y: number } | null>(null);

  const { data: agents = [] }    = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: allShifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });

  // Init visible
  useEffect(() => {
    if (agents.length > 0 && visible.size === 0)
      setVisible(new Set(agents.map(a => a.id)));
  }, [agents]);

  // Live UTC clock
  useEffect(() => {
    const t = setInterval(() => setUtcHour(getUTCHour()), 10000);
    return () => clearInterval(t);
  }, []);

  const todayShifts = allShifts.filter(s => s.dayOfWeek === selectedDay);

  // Init lever state
  useEffect(() => {
    const init: Record<number, LeverState> = {};
    for (const s of allShifts)
      init[s.id] = { activeStart: s.activeStart ?? s.startUtc, activeEnd: s.activeEnd ?? s.endUtc };
    setLeverState(init);
  }, [allShifts]);

  const toggleVisible = (id: number) => {
    setVisible(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setVisible(visible.size === agents.length ? new Set() : new Set(agents.map(a => a.id)));
  };

  const coverage    = calcCoverage(agents, todayShifts, visible, leverState);
  const maxCoverage = Math.max(...coverage, 1);

  // ── Agent summaries ──────────────────────────────────────────────────────
  const agentSummaries = agents.map(agent => {
    const agentTodayShifts = todayShifts.filter(s => s.agentId === agent.id);
    let baseHours = 0, activeHours = 0, overtimeHours = 0, releasedHours = 0;
    for (const s of agentTodayShifts) {
      const base   = shiftDuration(s.startUtc, s.endUtc);
      const ls     = leverState[s.id];
      const active = ls ? shiftDuration(ls.activeStart, ls.activeEnd) : base;
      baseHours   += base;
      activeHours += active;
      if (active > base) overtimeHours  += active - base;
      if (active < base) releasedHours  += base - active;
    }
    return { agent, baseHours, activeHours, overtimeHours, releasedHours, shifts: agentTodayShifts };
  });

  const zeroCoverageHours  = coverage.filter(c => c === 0).length;
  const peakCoverageHour   = coverage.indexOf(Math.max(...coverage));
  const totalOvertimeHours = agentSummaries.reduce((a, s) => a + s.overtimeHours, 0);
  const totalReleasedHours = agentSummaries.reduce((a, s) => a + s.releasedHours, 0);

  // ── Currently online ─────────────────────────────────────────────────────
  const todayUTCDay = getUTCDay();
  const onlineAgents = agents.filter(agent => {
    if (selectedDay !== todayUTCDay) return false;
    return todayShifts.some(s => {
      if (s.agentId !== agent.id) return false;
      const ls = leverState[s.id];
      const start = ls?.activeStart ?? s.startUtc;
      const end   = ls?.activeEnd   ?? s.endUtc;
      // Handle overnight shifts
      if (end >= start) return utcHour >= start && utcHour <= end;
      return utcHour >= start || utcHour <= end;
    });
  });

  const hasShiftsToday = todayShifts.length > 0;
  const isWeekend      = selectedDay === 0 || selectedDay === 6;

  const resetLevers = () => {
    const reset: Record<number, LeverState> = { ...leverState };
    for (const s of todayShifts)
      reset[s.id] = { activeStart: s.startUtc, activeEnd: s.endUtc };
    setLeverState(reset);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* ── Header ── */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-border shrink-0 bg-card/50 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">Coverage Command</h1>
            <Badge variant="outline" className="text-primary border-primary/30 text-xs font-mono">UTC</Badge>
          </div>

          {/* Day selector */}
          <div className="flex items-center gap-1">
            {DAYS.map((d, i) => {
              const hasShifts = allShifts.some(s => s.dayOfWeek === i);
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDay(i)}
                  data-testid={`day-${d}`}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-all relative",
                    selectedDay === i
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {d}
                  {hasShifts && selectedDay !== i && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary/50" />
                  )}
                </button>
              );
            })}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setViewMode("clock")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                viewMode === "clock" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="view-clock"
            >
              <Clock size={13} /> Clock
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                viewMode === "timeline" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="view-timeline"
            >
              <AlignLeft size={13} /> Timeline
            </button>
          </div>
        </header>

        {/* ── Currently Online strip ── */}
        {selectedDay === todayUTCDay && (
          <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-card/20 shrink-0">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium shrink-0">Online now</span>
            {onlineAgents.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No agents currently on shift</span>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                {onlineAgents.map(agent => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: agent.color + "20", border: `1px solid ${agent.color}40`, color: agent.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: agent.color }} />
                    {agent.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Main content ── */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── Left: Visualizer ── */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden min-w-0 relative">
            {!hasShiftsToday ? (
              <EmptyState isWeekend={isWeekend} day={DAYS[selectedDay]} />
            ) : viewMode === "clock" ? (
              <ClockVisualizer
                agents={agents}
                shifts={todayShifts}
                visible={visible}
                highlighted={highlighted}
                setHighlighted={setHighlighted}
                leverState={leverState}
                utcHour={utcHour}
                coverage={coverage}
                maxCoverage={maxCoverage}
                tooltipInfo={tooltipInfo}
                setTooltipInfo={setTooltipInfo}
              />
            ) : (
              <TimelineView
                agents={agents}
                shifts={todayShifts}
                visible={visible}
                highlighted={highlighted}
                setHighlighted={setHighlighted}
                leverState={leverState}
                utcHour={utcHour}
                coverage={coverage}
              />
            )}

            {/* Agent toggle pills — shown in both modes */}
            {hasShiftsToday && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-4 max-w-2xl">
                <button
                  onClick={toggleAll}
                  className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
                >
                  {visible.size === agents.length ? "Hide all" : "Show all"}
                </button>
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => toggleVisible(agent.id)}
                    onMouseEnter={() => setHighlighted(agent.id)}
                    onMouseLeave={() => setHighlighted(null)}
                    data-testid={`toggle-agent-${agent.id}`}
                    className={cn(
                      "text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all duration-150",
                      visible.has(agent.id) ? "opacity-100" : "opacity-40 grayscale"
                    )}
                    style={{
                      borderColor: agent.color + "60",
                      backgroundColor: visible.has(agent.id) ? agent.color + "20" : "transparent",
                      color: visible.has(agent.id) ? agent.color : "hsl(var(--muted-foreground))",
                      boxShadow: highlighted === agent.id ? `0 0 8px ${agent.color}50` : undefined,
                    }}
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Levers + Summary ── */}
          <div className="w-80 xl:w-96 flex flex-col border-l border-border overflow-hidden shrink-0">
            {/* KPI strip */}
            <div className="grid grid-cols-3 border-b border-border shrink-0">
              <KpiCell label="No Cover"  value={`${zeroCoverageHours}h`}                  warn={zeroCoverageHours > 0} />
              <KpiCell label="Peak Hr"   value={peakCoverageHour.toString().padStart(2,"0") + ":00"} />
              <KpiCell label="Overtime"  value={totalOvertimeHours > 0 ? `+${fmtDuration(totalOvertimeHours)}` : "+0"}     accent={totalOvertimeHours > 0} />
            </div>

            {/* Lever list with fade */}
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 overflow-y-auto overscroll-contain p-3 space-y-1.5" id="lever-scroll">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                      Shift Levers · {DAYS[selectedDay]}
                    </p>
                    {!isAdmin && (
                      <span className="flex items-center gap-1 text-[9px] text-muted-foreground border border-border rounded px-1 py-0.5">
                        <Lock size={8} /> View-only
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <button onClick={resetLevers} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <RotateCcw size={10} /> Reset
                    </button>
                  )}
                </div>

                {agentSummaries.filter(s => s.shifts.length > 0).map(({ agent, shifts: agentShifts, overtimeHours, releasedHours, baseHours }) => (
                  <ShiftLever
                    key={agent.id}
                    agent={agent}
                    shift={agentShifts[0]}
                    leverState={leverState[agentShifts[0]?.id]}
                    onLeverChange={(id, start, end) =>
                      setLeverState(prev => ({ ...prev, [id]: { activeStart: start, activeEnd: end } }))
                    }
                    highlighted={highlighted === agent.id}
                    onHighlight={() => setHighlighted(agent.id)}
                    onUnhighlight={() => setHighlighted(null)}
                    baseHours={baseHours}
                    overtimeHours={overtimeHours}
                    releasedHours={releasedHours}
                    isAdmin={isAdmin}
                  />
                ))}
                {agentSummaries.filter(s => s.shifts.length === 0).length > 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    {agentSummaries.filter(s => s.shifts.length === 0).length} agents off today
                  </p>
                )}
                {/* Spacer so fade doesn't cover last item */}
                <div className="h-8" />
              </div>
              {/* Fade gradient — indicates more content below */}
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
            </div>

            {/* Text summary panel */}
            <SummaryPanel
              agentSummaries={agentSummaries}
              selectedDay={selectedDay}
              zeroCoverageHours={zeroCoverageHours}
              peakCoverageHour={peakCoverageHour}
              totalOvertimeHours={totalOvertimeHours}
              totalReleasedHours={totalReleasedHours}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ isWeekend, day }: { isWeekend: boolean; day: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center max-w-xs">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Clock size={24} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">
          {isWeekend ? `${day} — Weekend` : `No shifts on ${day}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {isWeekend
            ? "No shifts are scheduled on weekends. Head to Agents to add weekend coverage."
            : "No agents have shifts scheduled for this day. Go to Agents to set up shifts."}
        </p>
      </div>
    </div>
  );
}

// ── Clock Visualizer ──────────────────────────────────────────────────────────
function ClockVisualizer({
  agents, shifts, visible, highlighted, setHighlighted,
  leverState, utcHour, coverage, maxCoverage,
  tooltipInfo, setTooltipInfo,
}: {
  agents: Agent[]; shifts: Shift[]; visible: Set<number>;
  highlighted: number | null; setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>; utcHour: number;
  coverage: number[]; maxCoverage: number;
  tooltipInfo: any; setTooltipInfo: (v: any) => void;
}) {
  const SIZE = 360;
  const CX = SIZE / 2, CY = SIZE / 2;
  const BASE_R = 108;
  const RING_W  = 10;
  const GAP     = 3;
  const HEAT_R  = BASE_R + agents.length * (RING_W + GAP) + 10;
  const svgRef  = useRef<SVGSVGElement>(null);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE} height={SIZE}
        className="overflow-visible"
        style={{ filter: "drop-shadow(0 0 30px rgba(0,0,0,0.8))" }}
        onMouseLeave={() => { setHighlighted(null); setTooltipInfo(null); }}
      >
        {/* Outer boundary ring */}
        <circle cx={CX} cy={CY} r={HEAT_R + 18} fill="none" stroke="hsl(224 14% 16%)" strokeWidth="1" opacity="0.6"/>
        {/* Clock face */}
        <circle cx={CX} cy={CY} r={BASE_R - 8} fill="hsl(224 18% 11%)" stroke="hsl(224 14% 22%)" strokeWidth="1.5"/>

        {/* Hour ticks */}
        {Array.from({ length: 24 }, (_, h) => {
          const angle = hourToAngle(h);
          const p1 = polarToCartesian(CX, CY, BASE_R - 16, angle);
          const p2 = polarToCartesian(CX, CY, BASE_R - 9, angle);
          return (
            <line key={h} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={h % 6 === 0 ? "hsl(51 100% 50%)" : "hsl(0 0% 28%)"}
              strokeWidth={h % 6 === 0 ? 1.5 : 0.75}
            />
          );
        })}

        {/* Hour labels 00 06 12 18 */}
        {[0, 6, 12, 18].map(h => {
          const p = polarToCartesian(CX, CY, BASE_R - 28, hourToAngle(h));
          return (
            <text key={h} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fontSize="8" fill="hsl(51 100% 50%)" fontFamily="Space Mono, monospace" fontWeight="700">
              {h.toString().padStart(2, "0")}
            </text>
          );
        })}

        {/* Coverage heatmap */}
        {coverage.map((cov, h) => {
          const intensity = cov / maxCoverage;
          const path = describeArc(CX, CY, HEAT_R, h, h + 1);
          return (
            <path key={`cov-${h}`} d={path} fill="none"
              stroke={cov === 0 ? "rgba(230,57,70,0.35)" : `rgba(255,215,0,${0.1 + intensity * 0.5})`}
              strokeWidth={cov === 0 ? 4 : 6} strokeLinecap="butt"
            />
          );
        })}

        {/* Agent rings */}
        {agents.map((agent, idx) => {
          const isVis  = visible.has(agent.id);
          const isHigh = highlighted === agent.id;
          const r      = BASE_R + idx * (RING_W + GAP);
          const alpha  = isVis ? (isHigh ? 1.0 : 0.72) : 0.10;
          const strokeW = isHigh ? RING_W + 2 : RING_W;

          return (
            <g key={agent.id}
              onMouseEnter={() => setHighlighted(agent.id)}
              onMouseLeave={() => setHighlighted(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Track */}
              <circle cx={CX} cy={CY} r={r} fill="none"
                stroke={hexToRgba(agent.color, 0.12)} strokeWidth={RING_W}
              />
              {shifts.filter(s => s.agentId === agent.id).map(shift => {
                const ls = leverState[shift.id];
                const as_ = ls?.activeStart ?? shift.startUtc;
                const ae  = ls?.activeEnd   ?? shift.endUtc;
                const baseDur = shift.endUtc - shift.startUtc;
                const actDur  = ae - as_;
                const hasOT   = actDur > baseDur;
                const hasRel  = actDur < baseDur;
                // Break: 30-min gap
                const bk = shift.breakStart;
                const bkEnd = bk != null ? bk + 0.5 : null;

                return (
                  <g key={shift.id}>
                    {/* Base outline */}
                    <path d={describeArc(CX, CY, r, shift.startUtc, shift.endUtc)}
                      fill="none" stroke={hexToRgba(agent.color, isVis ? 0.22 : 0.06)}
                      strokeWidth={RING_W}
                    />
                    {/* Invisible hit area for tooltip */}
                    <path d={describeArc(CX, CY, r, shift.startUtc, shift.endUtc)}
                      fill="none" stroke="white" strokeWidth={RING_W + 6}
                      strokeOpacity={0}
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                      onMouseEnter={(e) => {
                        const rect = svgRef.current?.getBoundingClientRect();
                        if (rect) setTooltipInfo({ agent, shift, x: e.clientX - rect.left, y: e.clientY - rect.top });
                      }}
                      onMouseLeave={() => setTooltipInfo(null)}
                    />
                    {/* Active arc — split around break gap if break is set */}
                    {isVis && bk == null && (
                      <path d={describeArc(CX, CY, r, as_, Math.min(ae, shift.endUtc))}
                        fill="none" stroke={hexToRgba(agent.color, alpha)}
                        strokeWidth={strokeW}
                      />
                    )}
                    {isVis && bk != null && bkEnd != null && (
                      <>
                        {/* Before break */}
                        <path d={describeArc(CX, CY, r, as_, Math.min(bk, Math.min(ae, shift.endUtc)))}
                          fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                        />
                        {/* After break */}
                        <path d={describeArc(CX, CY, r, Math.min(bkEnd, Math.min(ae, shift.endUtc)), Math.min(ae, shift.endUtc))}
                          fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                        />
                        {/* Break gap marker — dark notch on background track */}
                        <path d={describeArc(CX, CY, r, bk, bkEnd)}
                          fill="none" stroke="hsl(224 18% 8%)" strokeWidth={strokeW + 2}
                        />
                        {/* Break tick dots */}
                        {[bk, bkEnd].map((pt, pi) => {
                          const p = polarToCartesian(CX, CY, r, hourToAngle(pt));
                          return <circle key={pi} cx={p.x} cy={p.y} r={2}
                            fill={hexToRgba(agent.color, 0.7)} />;
                        })}
                      </>
                    )}
                    {/* Overtime glow */}
                    {isVis && hasOT && (
                      <path d={describeArc(CX, CY, r, shift.endUtc, ae)}
                        fill="none" stroke={agent.color} strokeWidth={strokeW}
                        strokeOpacity={isHigh ? 1 : 0.85}
                        style={{ filter: `drop-shadow(0 0 3px ${agent.color})` }}
                      />
                    )}
                    {/* Released dashes */}
                    {isVis && hasRel && (
                      <path d={describeArc(CX, CY, r, ae, shift.endUtc)}
                        fill="none" stroke="rgba(255,100,100,0.7)"
                        strokeWidth={strokeW * 0.6} strokeDasharray="3 3"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* UTC time hand */}
        {(() => {
          const angle = hourToAngle(utcHour);
          const tip  = polarToCartesian(CX, CY, HEAT_R + 12, angle);
          const base = polarToCartesian(CX, CY, 10, angle);
          return (
            <g>
              <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y}
                stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round" opacity="0.9"
              />
              <circle cx={tip.x} cy={tip.y} r={3} fill="hsl(51 100% 50%)" />
            </g>
          );
        })()}

        {/* Center hub */}
        <circle cx={CX} cy={CY} r={6} fill="hsl(51 100% 50%)" />
        <circle cx={CX} cy={CY} r={3} fill="hsl(224 16% 8%)" />
      </svg>

      {/* Hover tooltip */}
      {tooltipInfo && (
        <div
          className="absolute pointer-events-none z-50 px-2.5 py-1.5 rounded-md bg-card border border-border shadow-lg text-xs"
          style={{ left: tooltipInfo.x + 12, top: tooltipInfo.y - 10 }}
        >
          <div className="flex items-center gap-1.5 font-medium" style={{ color: tooltipInfo.agent.color }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tooltipInfo.agent.color }} />
            {tooltipInfo.agent.name}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {formatH(tooltipInfo.shift.startUtc)} – {formatH(tooltipInfo.shift.endUtc)} UTC
          </div>
          <div className="text-muted-foreground text-[10px]">
            {fmtDuration(shiftDuration(tooltipInfo.shift.startUtc, tooltipInfo.shift.endUtc))} shift
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-0 right-0 flex flex-col gap-1 bg-card/70 rounded-lg p-2 border border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-full bg-yellow-400 opacity-70" />
          <span className="text-[9px] text-muted-foreground">Coverage</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t border-dashed border-red-400 opacity-70" />
          <span className="text-[9px] text-muted-foreground">Up for grabs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-1.5 rounded-full bg-white" style={{ boxShadow: "0 0 4px white" }} />
          <span className="text-[9px] text-muted-foreground">Overtime</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px]">☕</span>
          <span className="text-[9px] text-muted-foreground">Break</span>
        </div>
      </div>
    </div>
  );
}

// ── Timeline View ─────────────────────────────────────────────────────────────
function TimelineView({
  agents, shifts, visible, highlighted, setHighlighted,
  leverState, utcHour, coverage,
}: {
  agents: Agent[]; shifts: Shift[]; visible: Set<number>;
  highlighted: number | null; setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>; utcHour: number;
  coverage: number[];
}) {
  const ROW_H    = 28;
  const LABEL_W  = 80;
  const CHART_W  = 520;
  const TOTAL_W  = LABEL_W + CHART_W + 16;
  const HOURS    = 24;
  const pxPerHr  = CHART_W / HOURS;

  // Hour gridlines
  const gridHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="w-full max-w-3xl overflow-x-auto">
      <div style={{ width: TOTAL_W, minWidth: TOTAL_W }}>

        {/* Header row: hour labels */}
        <div className="flex items-end mb-1" style={{ paddingLeft: LABEL_W }}>
          {gridHours.map(h => (
            <div key={h}
              className="text-[9px] font-mono text-muted-foreground absolute"
              style={{ left: LABEL_W + h * pxPerHr - 8, position: "relative", width: 0, textAlign: "center" }}
            >
              {h.toString().padStart(2, "0")}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Gridlines background */}
          <div className="absolute inset-0 pointer-events-none" style={{ left: LABEL_W }}>
            {gridHours.map(h => (
              <div key={h} className="absolute top-0 bottom-0 border-l border-border/50"
                style={{ left: h * pxPerHr }}
              />
            ))}
            {/* Current time line */}
            <div className="absolute top-0 bottom-0 border-l-2 border-primary z-10"
              style={{ left: utcHour * pxPerHr }}
            >
              <div className="absolute -top-1 -left-1.5 w-3 h-3 rounded-full bg-primary" />
            </div>
          </div>

          {agents.map((agent, idx) => {
            const agentShifts = shifts.filter(s => s.agentId === agent.id);
            const isVis  = visible.has(agent.id);
            const isHigh = highlighted === agent.id;

            return (
              <div key={agent.id}
                className={cn(
                  "flex items-center mb-1 rounded transition-all",
                  isHigh && "bg-muted/30"
                )}
                onMouseEnter={() => setHighlighted(agent.id)}
                onMouseLeave={() => setHighlighted(null)}
                style={{ opacity: isVis ? 1 : 0.25 }}
              >
                {/* Label */}
                <div className="flex items-center gap-1.5 shrink-0" style={{ width: LABEL_W }}>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                  <span className="text-[11px] font-medium truncate">{agent.name}</span>
                </div>

                {/* Bar area */}
                <div className="relative" style={{ width: CHART_W, height: ROW_H }}>
                  {agentShifts.map(shift => {
                    const ls = leverState[shift.id];
                    const as_ = ls?.activeStart ?? shift.startUtc;
                    const ae  = ls?.activeEnd   ?? shift.endUtc;
                    const baseDur = shiftDuration(shift.startUtc, shift.endUtc);
                    const actDur  = shiftDuration(as_, ae);
                    const hasOT  = actDur > baseDur;
                    const hasRel = actDur < baseDur;

                    // base bar
                    const baseLeft  = shift.startUtc * pxPerHr;
                    const baseWidth = baseDur * pxPerHr;
                    // active bar
                    const actLeft  = as_ * pxPerHr;
                    const actWidth = actDur * pxPerHr;

                    return (
                      <g key={shift.id} style={{ position: "absolute", inset: 0 }}>
                        {/* Base outline */}
                        <div className="absolute rounded-sm"
                          style={{
                            left: baseLeft, width: baseWidth,
                            top: 6, height: ROW_H - 12,
                            backgroundColor: agent.color + "20",
                            border: `1px solid ${agent.color}30`,
                          }}
                        />
                        {/* Active / reduced bar */}
                        <div className="absolute rounded-sm transition-all duration-150"
                          style={{
                            left: actLeft,
                            width: Math.max(2, Math.min(actWidth, baseWidth)),
                            top: 4, height: ROW_H - 8,
                            backgroundColor: agent.color,
                            opacity: isHigh ? 0.95 : 0.75,
                            boxShadow: isHigh ? `0 0 8px ${agent.color}60` : undefined,
                          }}
                        />
                        {/* Break gap — dark notch cut into active bar */}
                        {shift.breakStart != null && (() => {
                          const bkL = shift.breakStart * pxPerHr;
                          const bkW = 0.5 * pxPerHr;
                          return (
                            <>
                              <div className="absolute z-10 rounded-sm"
                                style={{
                                  left: bkL, width: Math.max(2, bkW),
                                  top: 2, height: ROW_H - 4,
                                  backgroundColor: "hsl(224 18% 8%)",
                                }}
                              />
                              {/* Coffee icon label */}
                              <div className="absolute z-20 flex items-center justify-center"
                                style={{
                                  left: bkL + bkW / 2 - 4, top: 0, width: 8, height: ROW_H,
                                  pointerEvents: "none",
                                }}
                              >
                                <span style={{ fontSize: 7, lineHeight: 1 }}>☕</span>
                              </div>
                            </>
                          );
                        })()}
                        {/* Overtime extension */}
                        {hasOT && (
                          <div className="absolute rounded-sm transition-all duration-150"
                            style={{
                              left: shift.endUtc * pxPerHr,
                              width: (ae - shift.endUtc) * pxPerHr,
                              top: 2, height: ROW_H - 4,
                              backgroundColor: agent.color,
                              opacity: 0.9,
                              boxShadow: `0 0 6px ${agent.color}80`,
                            }}
                          />
                        )}
                        {/* Released / up for grabs */}
                        {hasRel && (
                          <div className="absolute rounded-sm"
                            style={{
                              left: ae * pxPerHr,
                              width: (shift.endUtc - ae) * pxPerHr,
                              top: 8, height: ROW_H - 16,
                              background: "repeating-linear-gradient(90deg, rgba(255,100,100,0.5) 0px, rgba(255,100,100,0.5) 3px, transparent 3px, transparent 6px)",
                              border: "1px dashed rgba(255,100,100,0.4)",
                            }}
                          />
                        )}
                        {/* Shift hours label inside bar */}
                        {baseWidth > 40 && (
                          <div className="absolute flex items-center pointer-events-none"
                            style={{ left: baseLeft + 4, top: 6, height: ROW_H - 12 }}
                          >
                            <span className="text-[9px] font-mono font-bold"
                              style={{ color: "rgba(0,0,0,0.7)", mixBlendMode: "overlay" }}>
                              {formatH(shift.startUtc)}–{formatH(shift.endUtc)}
                            </span>
                          </div>
                        )}
                      </g>
                    );
                  })}
                  {agentShifts.length === 0 && (
                    <div className="absolute inset-y-0 flex items-center">
                      <span className="text-[9px] text-muted-foreground/40 italic ml-1">no shift</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Coverage density row */}
          <div className="flex items-center mt-2 border-t border-border/50 pt-2">
            <div className="text-[9px] text-muted-foreground uppercase shrink-0" style={{ width: LABEL_W }}>
              Coverage
            </div>
            <div className="relative" style={{ width: CHART_W, height: 12 }}>
              {coverage.map((cov, h) => (
                <div key={h} className="absolute top-0 h-full rounded-sm"
                  style={{
                    left: h * pxPerHr + 1,
                    width: pxPerHr - 2,
                    backgroundColor: cov === 0
                      ? "rgba(230,57,70,0.4)"
                      : `rgba(255,215,0,${0.1 + (cov / Math.max(...coverage, 1)) * 0.7})`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Hour axis */}
        <div className="relative mt-1" style={{ paddingLeft: LABEL_W }}>
          {gridHours.map(h => (
            <span key={h}
              className="absolute text-[9px] font-mono text-muted-foreground"
              style={{ left: h * pxPerHr - 6, transform: "none" }}
            >
              {h.toString().padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shift Lever ───────────────────────────────────────────────────────────────
function ShiftLever({
  agent, shift, leverState, onLeverChange,
  highlighted, onHighlight, onUnhighlight,
  baseHours, overtimeHours, releasedHours, isAdmin,
}: {
  agent: Agent; shift: Shift | undefined;
  leverState: LeverState | undefined;
  onLeverChange: (id: number, start: number, end: number) => void;
  highlighted: boolean; onHighlight: () => void; onUnhighlight: () => void;
  baseHours: number; overtimeHours: number; releasedHours: number;
  isAdmin: boolean;
}) {
  if (!shift || !leverState) return null;

  const { startUtc, endUtc } = shift;
  const { activeStart, activeEnd } = leverState;
  const baseDuration   = shiftDuration(startUtc, endUtc);
  const activeDuration = shiftDuration(activeStart, activeEnd);
  const hasOvertime    = activeDuration > baseDuration;
  const hasReleased    = activeDuration < baseDuration;

  const barMax    = 24;
  const baseLeft  = (startUtc  / barMax) * 100;
  const baseWidth = (baseDuration / barMax) * 100;
  const actLeft   = (activeStart  / barMax) * 100;
  const actWidth  = (activeDuration / barMax) * 100;

  const adjustEnd   = (delta: number) => { if (!isAdmin) return; onLeverChange(shift.id, activeStart, Math.max(activeStart + 0.5, Math.min(24, activeEnd + delta))); };
  const adjustStart = (delta: number) => { if (!isAdmin) return; onLeverChange(shift.id, Math.max(0, Math.min(activeEnd - 0.5, activeStart + delta)), activeEnd); };

  // Draggable bar refs
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ type: "start" | "end" | "move"; startX: number; startVal: number; startEnd: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent, type: "start" | "end" | "move") => {
    if (!isAdmin) return;
    e.preventDefault();
    dragging.current = { type, startX: e.clientX, startVal: activeStart, startEnd: activeEnd };
    const snap = (h: number) => Math.round(h * 2) / 2; // snap to nearest 30 min
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !barRef.current) return;
      const rect  = barRef.current.getBoundingClientRect();
      const delta = ((ev.clientX - dragging.current.startX) / rect.width) * 24;
      const { type: t, startVal, startEnd } = dragging.current;
      if (t === "start") {
        const ns = snap(Math.max(0, Math.min(startEnd - 0.5, startVal + delta)));
        onLeverChange(shift.id, ns, startEnd);
      } else if (t === "end") {
        const ne = snap(Math.max(startVal + 0.5, Math.min(24, startEnd + delta)));
        onLeverChange(shift.id, startVal, ne);
      } else {
        const dur = startEnd - startVal;
        const ns = snap(Math.max(0, Math.min(24 - dur, startVal + delta)));
        onLeverChange(shift.id, ns, ns + dur);
      }
    };
    const onUp = () => { dragging.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
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
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
          <span className="text-xs font-medium truncate max-w-[90px]">{agent.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasOvertime && fmtDuration(activeDuration - baseDuration) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium"
              style={{ background: agent.color + "30", color: agent.color }}>
              +{fmtDuration(activeDuration - baseDuration)} OT
            </span>
          )}
          {hasReleased && fmtDuration(baseDuration - activeDuration) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium bg-red-500/20 text-red-400">
              -{fmtDuration(baseDuration - activeDuration)} free
            </span>
          )}
          {shift.breakStart != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium bg-muted text-muted-foreground" title={`Break at ${formatH(shift.breakStart)} UTC`}>
              ☕ {formatH(shift.breakStart)}
            </span>
          )}
        </div>
      </div>

      {/* Draggable lever bar */}
      <div ref={barRef} className="relative h-5 bg-muted rounded-sm overflow-visible mb-2 select-none">
        {/* Base outline */}
        <div className="absolute h-full rounded-sm opacity-20"
          style={{ left: `${baseLeft}%`, width: `${baseWidth}%`, backgroundColor: agent.color }}
        />
        {/* Released dashes */}
        {hasReleased && (
          <div className="absolute h-3 top-1 rounded-sm"
            style={{
              left: `${(activeEnd / barMax) * 100}%`,
              width: `${(releasedHours / barMax) * 100}%`,
              background: "repeating-linear-gradient(90deg, rgba(255,100,100,0.5) 0px, rgba(255,100,100,0.5) 3px, transparent 3px, transparent 6px)",
            }}
          />
        )}
        {/* Active bar — draggable body */}
        <div
          className="absolute h-full rounded-sm transition-none"
          style={{
            left: `${actLeft}%`,
            width: `${Math.max(1, Math.min(actWidth, hasOvertime ? actWidth : baseWidth))}%`,
            backgroundColor: agent.color,
            opacity: hasOvertime ? 0.9 : hasReleased ? 0.55 : 0.75,
            boxShadow: hasOvertime ? `0 0 6px ${agent.color}80` : undefined,
            cursor: isAdmin ? "grab" : "default",
          }}
          onMouseDown={e => onMouseDown(e, "move")}
        />
        {/* Overtime extension */}
        {hasOvertime && (
          <div className="absolute h-full rounded-sm"
            style={{
              left: `${(endUtc / barMax) * 100}%`,
              width: `${((activeEnd - endUtc) / barMax) * 100}%`,
              backgroundColor: agent.color,
              boxShadow: `0 0 8px ${agent.color}`,
            }}
          />
        )}
        {/* Break notch on lever bar */}
        {shift.breakStart != null && (() => {
          const bkLeft = (shift.breakStart / barMax) * 100;
          const bkWidth = (0.5 / barMax) * 100;
          return (
            <div className="absolute top-0 bottom-0 z-20 rounded-sm"
              style={{ left: `${bkLeft}%`, width: `${Math.max(1, bkWidth)}%`, backgroundColor: "hsl(224 18% 10%)", opacity: 0.9 }}
              title={`Break: ${formatH(shift.breakStart)}–${formatH(shift.breakStart + 0.5)}`}
            />
          );
        })()}
        {/* Drag handles: start (left edge) and end (right edge) */}
        {isAdmin && (
          <div
            className="absolute top-0 bottom-0 w-2 rounded-l-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `${actLeft}%` }}
            onMouseDown={e => onMouseDown(e, "start")}
          />
        )}
        {isAdmin && (
          <div
            className="absolute top-0 bottom-0 w-2 rounded-r-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `calc(${actLeft}% + ${Math.max(1, actWidth)}% - 8px)` }}
            onMouseDown={e => onMouseDown(e, "end")}
          />
        )}
      </div>

      {/* Time labels + fine-tune buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {isAdmin && <button onClick={() => adjustStart(-0.5)} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier start">← 30m</button>}
          {isAdmin && <button onClick={() => adjustStart(0.5)}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later start">30m →</button>}
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatH(activeStart)}</span>
        </div>
        <span className="text-[9px] text-muted-foreground font-mono tabular-nums">
          {fmtDuration(activeDuration)}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatH(activeEnd)}</span>
          {isAdmin && <button onClick={() => adjustEnd(-0.5)} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier end">← 30m</button>}
          {isAdmin && <button onClick={() => adjustEnd(0.5)}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later end">30m →</button>}
        </div>
      </div>
    </div>
  );
}

// ── KPI Cell ──────────────────────────────────────────────────────────────────
function KpiCell({ label, value, warn, accent }: { label: string; value: string; warn?: boolean; accent?: boolean }) {
  return (
    <div className="p-2.5 border-r last:border-r-0 border-border text-center">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn("text-sm font-mono font-bold tabular-nums",
        warn ? "text-red-400" : accent ? "text-primary" : "text-foreground"
      )}>{value}</p>
    </div>
  );
}

// ── Summary Panel ─────────────────────────────────────────────────────────────
function SummaryPanel({ agentSummaries, selectedDay, zeroCoverageHours, peakCoverageHour, totalOvertimeHours, totalReleasedHours }: any) {
  return (
    <div className="border-t border-border p-3 max-h-52 overflow-y-auto overscroll-contain bg-card/30 shrink-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-medium">
        Coverage Report · {DAYS[selectedDay]}
      </p>
      {zeroCoverageHours > 0 && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-[10px] text-red-400 font-medium">
            ⚠ {zeroCoverageHours} hour{zeroCoverageHours !== 1 ? "s" : ""} with zero coverage
          </p>
        </div>
      )}
      <div className="space-y-1">
        {agentSummaries.map(({ agent, baseHours, activeHours, overtimeHours, releasedHours }: any) => {
          if (baseHours === 0) return null;
          return (
            <div key={agent.id} className="flex items-start gap-2 text-[10px]">
              <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: agent.color }} />
              <div className="flex-1">
                <span className="font-medium text-foreground">{agent.name}</span>
                <span className="text-muted-foreground ml-1">{fmtDuration(activeHours)}</span>
                {overtimeHours > 0 && <span className="ml-1" style={{ color: agent.color }}>+{fmtDuration(overtimeHours)} OT</span>}
                {releasedHours > 0 && <span className="ml-1 text-red-400">{fmtDuration(releasedHours)} up for grabs</span>}
              </div>
            </div>
          );
        })}
      </div>
      {(totalOvertimeHours > 0 || totalReleasedHours > 0) && (
        <div className="mt-2 pt-2 border-t border-border">
          {totalOvertimeHours > 0 && <p className="text-[10px] text-primary">Total overtime: +{fmtDuration(totalOvertimeHours)}</p>}
          {totalReleasedHours > 0 && <p className="text-[10px] text-red-400">Total up for grabs: {fmtDuration(totalReleasedHours)}</p>}
        </div>
      )}
    </div>
  );
}
