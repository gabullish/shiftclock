import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, Shift } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RotateCcw, Clock, AlignLeft, Lock, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";
import {
  segmentShift,
  resolveShift,
  resolveBreak,
  shiftProgress,
  calcCoverageForDay,
  formatUtcHour,
  formatDuration,
  shiftLabel,
  shiftDuration,
  normaliseEndUtc,
  displayHour,
} from "@/lib/shiftUtils";

const DAYS   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getUTCDay()  { return new Date().getUTCDay(); }
function getUTCHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
}

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

interface LeverState { activeStart: number; activeEnd: number; }

// ── Day descriptors for multi-day canvas ─────────────────────────────────────
interface DayDesc {
  date: string;
  dayOfWeek: number;
  label: string;
  dateLabel: string;
  isToday: boolean;
  dayIndex: number;
}

function buildDays(pastDays: number, futureDays: number): DayDesc[] {
  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const result: DayDesc[] = [];
  const total = pastDays + 1 + futureDays;
  for (let i = 0; i < total; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - pastDays + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dow     = d.getUTCDay();
    result.push({
      date: dateStr,
      dayOfWeek: dow,
      label: DAYS[dow],
      dateLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
      isToday: dateStr === todayStr,
      dayIndex: i,
    });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const isAdmin = useAdminMode();

  const initDay = () => {
    const d = getUTCDay();
    return (d === 0 || d === 6) ? 1 : d;
  };

  const [selectedDay,    setSelectedDay]    = useState<number>(initDay);
  const [visible,        setVisible]        = useState<Set<number>>(new Set());
  const [highlighted,    setHighlighted]    = useState<number | null>(null);
  const [leverState,     setLeverState]     = useState<Record<number, LeverState>>({});
  const [utcHour,        setUtcHour]        = useState(getUTCHour());
  const [viewMode,       setViewMode]       = useState<"clock" | "timeline">("clock");
  const [timelineScope,  setTimelineScope]  = useState<"day" | "multi">("day");
  const [tooltipInfo,    setTooltipInfo]    = useState<{ agent: Agent; shift: Shift; x: number; y: number; pct: number; otPct: number } | null>(null);

  const { data: agents    = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: allShifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });

  useEffect(() => {
    if (agents.length > 0 && visible.size === 0)
      setVisible(new Set(agents.map(a => a.id)));
  }, [agents]);

  useEffect(() => {
    const t = setInterval(() => setUtcHour(getUTCHour()), 1000);
    return () => clearInterval(t);
  }, []);

  const todayShifts = allShifts.filter(s => s.dayOfWeek === selectedDay);

  useEffect(() => {
    const init: Record<number, LeverState> = {};
    for (const s of allShifts) {
      const normEnd = normaliseEndUtc(s.startUtc, s.endUtc);
      init[s.id] = {
        activeStart: s.activeStart ?? s.startUtc,
        activeEnd:   s.activeEnd   ?? normEnd,
      };
    }
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

  const coverageInput = todayShifts
    .filter(s => visible.has(s.agentId))
    .map(s => {
      const ls = leverState[s.id];
      return {
        activeStart: ls?.activeStart ?? s.startUtc,
        activeEnd:   ls?.activeEnd   ?? normaliseEndUtc(s.startUtc, s.endUtc),
      };
    });
  const coverage    = calcCoverageForDay(coverageInput);
  const maxCoverage = Math.max(...coverage, 1);

  const agentSummaries = agents.map(agent => {
    const agentTodayShifts = todayShifts.filter(s => s.agentId === agent.id);
    let baseHours = 0, activeHours = 0, overtimeHours = 0, releasedHours = 0;
    for (const s of agentTodayShifts) {
      const ls = leverState[s.id];
      const resolved = resolveShift(
        s.startUtc, s.endUtc,
        ls?.activeStart ?? null, ls?.activeEnd ?? null,
        s.breakStart ?? null
      );
      baseHours     += resolved.baseDuration;
      activeHours   += resolved.activeDuration;
      overtimeHours += resolved.overtimeHours;
      releasedHours += resolved.shrinkHours;
    }
    return { agent, baseHours, activeHours, overtimeHours, releasedHours, shifts: agentTodayShifts };
  });

  const zeroCoverageHours  = coverage.filter(c => c === 0).length;
  const peakCoverageHour   = coverage.indexOf(Math.max(...coverage));
  const totalOvertimeHours = agentSummaries.reduce((a, s) => a + s.overtimeHours, 0);
  const totalReleasedHours = agentSummaries.reduce((a, s) => a + s.releasedHours, 0);

  const todayUTCDay  = getUTCDay();
  const onlineAgents = agents.filter(agent => {
    if (selectedDay !== todayUTCDay) return false;
    return todayShifts.some(s => {
      if (s.agentId !== agent.id) return false;
      const ls    = leverState[s.id];
      const start = ls?.activeStart ?? s.startUtc;
      const end   = ls?.activeEnd   ?? normaliseEndUtc(s.startUtc, s.endUtc);
      if (end <= 24) return utcHour >= start && utcHour <= end;
      return utcHour >= start || utcHour <= (end - 24);
    });
  });

  const hasShiftsToday = todayShifts.length > 0;
  const isWeekend      = selectedDay === 0 || selectedDay === 6;

  const resetLevers = () => {
    const reset: Record<number, LeverState> = { ...leverState };
    for (const s of todayShifts)
      reset[s.id] = { activeStart: s.startUtc, activeEnd: normaliseEndUtc(s.startUtc, s.endUtc) };
    setLeverState(reset);
  };

  const isMulti = viewMode === "timeline" && timelineScope === "multi";

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* ── Header ── */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-border shrink-0 bg-card/50 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">Coverage Command</h1>
            <Badge variant="outline" className="text-primary border-primary/30 text-xs font-mono">UTC</Badge>
          </div>

          {!isMulti && (
            <div className="flex items-center gap-1">
              {DAYS.map((d, i) => {
                const hasShifts = allShifts.some(s => s.dayOfWeek === i);
                return (
                  <button key={d} onClick={() => setSelectedDay(i)} data-testid={`day-${d}`}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-all relative",
                      selectedDay === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
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
          )}

          {isMulti && (
            <span className="text-xs text-muted-foreground font-mono">14-day view · scroll to navigate · click day label → Day view</span>
          )}

          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setViewMode("clock")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                viewMode === "clock" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              data-testid="view-clock"
            >
              <Clock size={13} /> Clock
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                viewMode === "timeline" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              data-testid="view-timeline"
            >
              <AlignLeft size={13} /> Timeline
            </button>

            {viewMode === "timeline" && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  onClick={() => setTimelineScope("day")}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium transition-all",
                    timelineScope === "day" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="timeline-scope-day"
                >
                  Day
                </button>
                <button
                  onClick={() => setTimelineScope("multi")}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-all",
                    timelineScope === "multi" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="timeline-scope-14day"
                >
                  <CalendarRange size={11} /> 14D
                </button>
              </>
            )}
          </div>
        </header>

        {!isMulti && selectedDay === todayUTCDay && (
          <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-card/20 shrink-0">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium shrink-0">Online now</span>
            {onlineAgents.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No agents currently on shift</span>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                {onlineAgents.map(agent => (
                  <div key={agent.id}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: agent.color + "20", border: `1px solid ${agent.color}40`, color: agent.color }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: agent.color }} />
                    {agent.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isMulti ? (
          <div className="flex-1 overflow-hidden">
            <UnifiedTimeline
              scope="multi"
              agents={agents}
              allShifts={allShifts}
              visible={visible}
              highlighted={highlighted}
              setHighlighted={setHighlighted}
              leverState={leverState}
              utcHour={utcHour}
              selectedDay={selectedDay}
              onSelectDay={(dow) => { setSelectedDay(dow); setTimelineScope("day"); }}
            />
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden min-w-0 relative">
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
                  selectedDay={selectedDay}
                />
              ) : (
                <UnifiedTimeline
                  scope="day"
                  agents={agents}
                  allShifts={allShifts}
                  visible={visible}
                  highlighted={highlighted}
                  setHighlighted={setHighlighted}
                  leverState={leverState}
                  utcHour={utcHour}
                  selectedDay={selectedDay}
                  onSelectDay={(dow) => setSelectedDay(dow)}
                />
              )}

            {hasShiftsToday && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-3 max-w-2xl">
                <button onClick={toggleAll}
                  className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all">
                  {visible.size === agents.length ? "Hide all" : "Show all"}
                </button>
                {agents.map(agent => (
                  <button key={agent.id}
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
                  {agents.map(agent => (
                    <button key={agent.id}
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

            <div className="w-80 xl:w-96 flex flex-col border-l border-border overflow-hidden shrink-0">
              <div className="grid grid-cols-3 border-b border-border shrink-0">
                <KpiCell label="No Cover" value={`${zeroCoverageHours}h`} warn={zeroCoverageHours > 0} />
                <KpiCell label="Peak Hr"  value={peakCoverageHour.toString().padStart(2, "0") + ":00"} />
                <KpiCell label="Overtime" value={totalOvertimeHours > 0 ? `+${formatDuration(totalOvertimeHours)}` : "+0"} accent={totalOvertimeHours > 0} />
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="w-80 xl:w-96 flex flex-col border-l border-border overflow-hidden shrink-0">
            <div className="grid grid-cols-3 border-b border-border shrink-0">
              <KpiCell label="No Cover" value={`${zeroCoverageHours}h`} warn={zeroCoverageHours > 0} />
              <KpiCell label="Peak Hr"  value={peakCoverageHour.toString().padStart(2, "0") + ":00"} />
              <KpiCell label="Overtime" value={totalOvertimeHours > 0 ? `+${formatDuration(totalOvertimeHours)}` : "+0"} accent={totalOvertimeHours > 0} />
            </div>

            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 overflow-y-auto overscroll-contain p-3 space-y-1.5" id="lever-scroll">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Shift Levers · {DAYS[selectedDay]}</p>
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
                    utcHour={utcHour}
                    selectedDay={selectedDay}
                  />
                ))}
                {agentSummaries.filter(s => s.shifts.length === 0).length > 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    {agentSummaries.filter(s => s.shifts.length === 0).length} agents off today
                  </p>
                )}
                <div className="h-8" />
              </div>
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
            </div>

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

// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
function UnifiedTimeline({
  scope, agents, allShifts, visible, highlighted, setHighlighted,
  leverState, utcHour, selectedDay, onSelectDay,
}: {
  scope: "day" | "multi";
  agents: Agent[];
  allShifts: Shift[];
  visible: Set<number>;
  highlighted: number | null;
  setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>;
  utcHour: number;
  selectedDay: number;
  onSelectDay: (dow: number) => void;
}) {
  const PX_PER_HOUR = 44;
  const LABEL_W     = 92;
  const RULER_H     = 40;
  const COV_H       = 14;
  const ROW_H       = agents.length > 12 ? 22 : agents.length > 8 ? 26 : 30;

  const PAST_DAYS   = 7;
  const FUTURE_DAYS = 6;
  const days        = scope === "multi" ? buildDays(PAST_DAYS, FUTURE_DAYS) : null;
  const todayIndex  = PAST_DAYS;

  const TOTAL_HOURS = scope === "multi" ? (days!.length * 24) : 24;
  const CANVAS_W    = TOTAL_HOURS * PX_PER_HOUR;
  const CANVAS_H    = RULER_H + agents.length * (ROW_H + 2) + COV_H + 20;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [barTooltip, setBarTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (scope === "multi") {
      const nowPx = (todayIndex * 24 + utcHour) * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, nowPx - w / 2 + LABEL_W);
    } else {
      const nowPx = utcHour * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth - LABEL_W;
      if (nowPx > w * 0.6) {
        scrollRef.current.scrollLeft = Math.max(0, nowPx - w * 0.3);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const scrollToNow = () => {
    if (!scrollRef.current) return;
    if (scope === "multi") {
      const nowPx = (todayIndex * 24 + utcHour) * PX_PER_HOUR;
      const w     = scrollRef.current.clientWidth;
      scrollRef.current.scrollTo({ left: Math.max(0, nowPx - w / 2 + LABEL_W), behavior: "smooth" });
    } else {
      scrollRef.current.scrollTo({ left: Math.max(0, utcHour * PX_PER_HOUR - 80), behavior: "smooth" });
    }
  };

  const nowCanvasPx = scope === "multi"
    ? (todayIndex * 24 + utcHour) * PX_PER_HOUR
    : utcHour * PX_PER_HOUR;

  const gridHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  const renderAgentRow = (agent: Agent, dayOffset: number, dayShifts: Shift[], coverageForDay?: number[]) => {
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
      const { pct, otPct } = scope === "day" && selectedDay === getUTCDay()
        ? shiftProgress(shift.startUtc, shift.endUtc, as_, ae, utcHour)
        : { pct: 0, otPct: 0 };
      const barLabel = `${agent.name}: ${shiftLabel(shift.startUtc, shift.endUtc)} · ${formatDuration(resolved.baseDuration)}`;

      return (
        <div key={shift.id} style={{ position: "absolute", inset: 0 }}>
          {baseSegs.map((seg, si) => (
            <div key={`ghost-${si}`}
              style={{
                position: "absolute",
                left: rowOffsetX + seg.start * PX_PER_HOUR,
                width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                top: 6, height: ROW_H - 12,
                backgroundColor: agent.color + (isVis ? "28" : "10"),
                border: `1px solid ${agent.color}${isVis ? "35" : "15"}`,
                borderRadius: 3,
              }}
            />
          ))}

          {isOvernight && (() => {
            const seg0 = baseSegs[0];
            const x1   = rowOffsetX + seg0.end * PX_PER_HOUR;
            const midY = ROW_H / 2;
            return (
              <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: ROW_H, overflow: "visible", pointerEvents: "none" }}>
                <circle cx={x1}    cy={midY} r={2.5} fill={agent.color} opacity={isVis ? 0.5 : 0.15} />
                <circle cx={rowOffsetX} cy={midY} r={2.5} fill={agent.color} opacity={isVis ? 0.5 : 0.15} />
                <line x1={x1} y1={midY} x2={rowOffsetX + CANVAS_W} y2={midY}
                  stroke={agent.color} strokeWidth={1} strokeDasharray="3 3" opacity={isVis ? 0.35 : 0.1} />
                <text x={x1 + 3} y={midY - 4} fontSize="7" fill={agent.color} opacity={isVis ? 0.7 : 0.2} fontFamily="monospace">+1</text>
              </svg>
            );
          })()}

          {isVis && activeSegs.map((seg, si) => {
            const segEnd = resolved.hasOvertime ? seg.end : Math.min(seg.end, seg.dayOffset === 0 ? normBaseEnd : normBaseEnd - 24);
            if (segEnd <= seg.start) return null;
            const barLeft = rowOffsetX + seg.start * PX_PER_HOUR;
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
            const bkL = rowOffsetX + bk * PX_PER_HOUR;
            const bkW = Math.max(4, 0.5 * PX_PER_HOUR);
            return (
              <>
                <div style={{ position: "absolute", left: bkL, width: bkW, top: 2, height: ROW_H - 4, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 2, zIndex: 2 }} />
                <div style={{ position: "absolute", left: bkL + bkW / 2 - 5, top: 0, width: 10, height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, zIndex: 3, pointerEvents: "none" }}>☕</div>
              </>
            );
          })()}

          {isVis && resolved.hasOvertime && (() => {
            const otSegs = segmentShift(normBaseEnd, ae);
            return otSegs.map((seg, si) => (
              <div key={`ot-${si}`}
                style={{
                  position: "absolute",
                  left: rowOffsetX + seg.start * PX_PER_HOUR,
                  width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                  top: 2, height: ROW_H - 4,
                  backgroundColor: agent.color, opacity: 0.9, borderRadius: 3,
                  boxShadow: `0 0 4px white, 0 0 8px ${agent.color}`,
                }}
              />
            ));
          })()}

          {isVis && resolved.hasShrink && (() => {
            const shrinkSegs = segmentShift(ae, normBaseEnd);
            return shrinkSegs.map((seg, si) => (
              <div key={`shrink-${si}`}
                style={{
                  position: "absolute",
                  left: rowOffsetX + seg.start * PX_PER_HOUR,
                  width: Math.max(2, (seg.end - seg.start) * PX_PER_HOUR),
                  top: 8, height: ROW_H - 16, borderRadius: 2,
                  background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.7) 0px,rgba(255,140,0,0.7) 3px,transparent 3px,transparent 6px)",
                  border: "1px dashed rgba(255,140,0,0.6)",
                }}
              />
            ));
          })()}
        </div>
      );
    });
  };

  const renderCoverageStrip = (shiftsForDay: Shift[], dayOffsetPx: number) => {
    const covInput = shiftsForDay
      .filter(s => visible.has(s.agentId))
      .map(s => {
        const ls = leverState[s.id];
        return {
          activeStart: ls?.activeStart ?? s.startUtc,
          activeEnd:   ls?.activeEnd   ?? normaliseEndUtc(s.startUtc, s.endUtc),
        };
      });
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
    return gridHours.map(h => {
      const x        = offsetPx + h * PX_PER_HOUR;
      const isMajor  = h % 6 === 0;
      return (
        <div key={`ruler-${offsetPx}-${h}`} style={{ position: "absolute", left: x, top: 0, bottom: 0 }}>
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
              {h.toString().padStart(2, "0")}
            </span>
          )}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-background" onMouseLeave={() => setBarTooltip(null)}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-[11px] text-muted-foreground">
          {scope === "multi"
            ? `${days![0].dateLabel} — ${days![days!.length - 1].dateLabel} · UTC`
            : `${DAY_FULL[selectedDay]} · UTC · all times`}
        </span>
        <button
          onClick={scrollToNow}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all font-medium"
        >
          <Clock size={11} /> Now
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto"
        style={{ scrollBehavior: "auto" }}
      >
        <div style={{ display: "flex", minWidth: CANVAS_W + LABEL_W, height: CANVAS_H, position: "relative" }}>

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

          <div style={{ position: "relative", width: CANVAS_W, flexShrink: 0 }}>

            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: RULER_H, zIndex: 10, borderBottom: "1px solid hsl(var(--border) / 0.6)" }}>
              {scope === "day" ? (
                renderDayRuler(0)
              ) : (
                <>
                  {Array.from({ length: TOTAL_HOURS + 1 }, (_, h) => {
                    if (h % 3 !== 0) return null;
                    const x        = h * PX_PER_HOUR;
                    const localH   = h % 24;
                    const isMid    = localH === 0;
                    return (
                      <div key={h} style={{ position: "absolute", left: x, top: 0, bottom: 0 }}>
                        <div style={{
                          position: "absolute",
                          top: isMid ? 0 : RULER_H - 8, bottom: 0, width: 1,
                          backgroundColor: isMid ? "hsl(var(--border))" : "hsl(var(--border) / 0.4)",
                        }} />
                        {!isMid && (
                          <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, fontFamily: "monospace", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                            {localH.toString().padStart(2, "0")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* Day labels — click uses full date to derive correct dayOfWeek */}
                  {days!.map(day => {
                    const x         = day.dayIndex * 24 * PX_PER_HOUR;
                    const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6;
                    return (
                      <div
                        key={day.date}
                        onClick={() => {
                          const d = new Date(day.date + "T00:00:00Z");
                          onSelectDay(d.getUTCDay());
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
                if (h % 3 !== 0 || h % 24 === 0) return null;
                return (
                  <div key={h} style={{
                    position: "absolute", left: h * PX_PER_HOUR,
                    top: RULER_H, bottom: 0, width: 1,
                    backgroundColor: "hsl(var(--border) / 0.2)", pointerEvents: "none",
                  }} />
                );
              })
            )}

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
                    renderAgentRow(agent, 0, allShifts.filter(s => s.dayOfWeek === selectedDay))
                  ) : (
                    days!.map(day => (
                      <div key={day.date} style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW_H }}>
                        {renderAgentRow(agent, day.dayIndex, allShifts.filter(s => s.dayOfWeek === day.dayOfWeek))}
                      </div>
                    ))
                  )}
                </div>
              );
            })}

            <div style={{
              position: "absolute",
              top: RULER_H + agents.length * (ROW_H + 2) + 4,
              left: 0, right: 0, height: COV_H,
            }}>
              {scope === "day"
                ? renderCoverageStrip(allShifts.filter(s => s.dayOfWeek === selectedDay), 0)
                : days!.map(day => renderCoverageStrip(allShifts.filter(s => s.dayOfWeek === day.dayOfWeek), day.dayIndex * 24 * PX_PER_HOUR))
              }
            </div>

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

// ─────────────────────────────────────────────────────────────────────────────
function ClockVisualizer({
  agents, shifts, visible, highlighted, setHighlighted,
  leverState, utcHour, coverage, maxCoverage,
  tooltipInfo, setTooltipInfo, selectedDay,
}: {
  agents: Agent[]; shifts: Shift[]; visible: Set<number>;
  highlighted: number | null; setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>; utcHour: number;
  coverage: number[]; maxCoverage: number;
  tooltipInfo: any; setTooltipInfo: (v: any) => void;
  selectedDay: number;
}) {
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

  return (
    <div className="relative flex items-center justify-center">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE} height={SIZE}
        className="overflow-visible"
        style={{ filter: "drop-shadow(0 0 30px rgba(0,0,0,0.8))" }}
        onMouseLeave={() => { setHighlighted(null); setTooltipInfo(null); }}
      >
        <circle cx={CX} cy={CY} r={HEAT_R + 18} fill="none" stroke="hsl(224 14% 16%)" strokeWidth="1" opacity="0.6" />
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

        {coverage.map((cov, h) => {
          if (cov === 0) {
            return (
              <path key={`cov-${h}`}
                d={describeArc(CX, CY, HEAT_R, h, h + 1)}
                fill="none" stroke="rgba(230,57,70,0.35)" strokeWidth={4} strokeLinecap="butt"
              />
            );
          }
          const coveringColors: string[] = [];
          for (const agent of agents) {
            if (!visible.has(agent.id)) continue;
            const agentShift = shifts.find(s => s.agentId === agent.id);
            if (!agentShift) continue;
            const ls    = leverState[agentShift.id];
            const start = ls?.activeStart ?? agentShift.startUtc;
            const end   = ls?.activeEnd   ?? normaliseEndUtc(agentShift.startUtc, agentShift.endUtc);
            const segs  = segmentShift(start, end);
            const covers = segs.some(seg => h >= seg.start && h < seg.end);
            if (covers) coveringColors.push(agent.color);
          }
          if (coveringColors.length === 0) coveringColors.push("#FFD700");
          const intensity = cov / maxCoverage;
          const color = coveringColors[0];
          return (
            <path key={`cov-${h}`}
              d={describeArc(CX, CY, HEAT_R, h, h + 1)}
              fill="none"
              stroke={hexToRgba(color, 0.1 + intensity * 0.55)}
              strokeWidth={6} strokeLinecap="butt"
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
            <g key={agent.id}
              onMouseEnter={() => setHighlighted(agent.id)}
              onMouseLeave={() => setHighlighted(null)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={CX} cy={CY} r={r} fill="none"
                stroke={hexToRgba(agent.color, 0.12)} strokeWidth={RING_W}
              />
              {shifts.filter(s => s.agentId === agent.id).map(shift => {
                const ls  = leverState[shift.id];
                const as_ = ls?.activeStart ?? shift.startUtc;
                const ae  = ls?.activeEnd   ?? normaliseEndUtc(shift.startUtc, shift.endUtc);
                const resolved = resolveShift(shift.startUtc, shift.endUtc, as_, ae, shift.breakStart ?? null);
                const bk = resolved.breakStart;
                const { pct, otPct } = isToday
                  ? shiftProgress(shift.startUtc, shift.endUtc, as_, ae, utcHour)
                  : { pct: 0, otPct: 0 };

                const baseSegs    = segmentShift(shift.startUtc, normaliseEndUtc(shift.startUtc, shift.endUtc));
                const activeSegs  = segmentShift(as_, ae);
                const normBaseEnd = normaliseEndUtc(shift.startUtc, shift.endUtc);

                return (
                  <g key={shift.id}>
                    {baseSegs.map((seg, si) => (
                      <path key={`ghost-${si}`}
                        d={describeArc(CX, CY, r, seg.start, seg.end)}
                        fill="none" stroke={hexToRgba(agent.color, isVis ? 0.22 : 0.06)}
                        strokeWidth={RING_W}
                      />
                    ))}
                    {baseSegs.map((seg, si) => (
                      <path key={`hit-${si}`}
                        d={describeArc(CX, CY, r, seg.start, seg.end)}
                        fill="none" stroke="white" strokeWidth={RING_W + 6} strokeOpacity={0}
                        style={{ cursor: "pointer", pointerEvents: "all" }}
                        onMouseEnter={(e) => {
                          const rect = svgRef.current?.getBoundingClientRect();
                          if (rect) setTooltipInfo({ agent, shift, x: e.clientX - rect.left, y: e.clientY - rect.top, pct, otPct });
                        }}
                        onMouseLeave={() => setTooltipInfo(null)}
                      />
                    ))}
                    {isVis && bk == null && activeSegs.map((seg, si) => {
                      const segEnd = resolved.hasOvertime ? seg.end : Math.min(seg.end, seg.dayOffset === 0 ? normBaseEnd : normBaseEnd - 24);
                      if (segEnd <= seg.start) return null;
                      return (
                        <path key={`active-${si}`}
                          d={describeArc(CX, CY, r, seg.start, segEnd)}
                          fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
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
                            />
                          )}
                          {afterStart < segEnd && (
                            <path d={describeArc(CX, CY, r, afterStart, segEnd)}
                              fill="none" stroke={hexToRgba(agent.color, alpha)} strokeWidth={strokeW}
                            />
                          )}
                          <path d={describeArc(CX, CY, r, bk, Math.min(bkEnd, segEnd))}
                            fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={strokeW + 2}
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
                      const otSegs = segmentShift(normBaseEnd, ae);
                      return otSegs.map((seg, si) => (
                        <path key={`ot-${si}`}
                          d={describeArc(CX, CY, r, seg.start, seg.end)}
                          fill="none" stroke={agent.color} strokeWidth={strokeW + 2}
                          strokeOpacity={isHigh ? 1 : 0.9}
                          style={{ filter: `drop-shadow(0 0 3px white) drop-shadow(0 0 6px ${agent.color})` }}
                        />
                      ));
                    })()}
                    {isVis && resolved.hasShrink && (() => {
                      const shrinkSegs = segmentShift(ae, normBaseEnd);
                      return shrinkSegs.map((seg, si) => (
                        <path key={`shrink-${si}`}
                          d={describeArc(CX, CY, r, seg.start, seg.end)}
                          fill="none" stroke="rgba(255,140,0,0.85)"
                          strokeWidth={strokeW * 0.6} strokeDasharray="3 3"
                        />
                      ));
                    })()}
                  </g>
                );
              })}
            </g>
          );
        })}

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

        <circle cx={CX} cy={CY} r={6} fill="hsl(51 100% 50%)" style={{ pointerEvents: "none" }} />
        <circle cx={CX} cy={CY} r={3} fill="hsl(224 16% 8%)" style={{ pointerEvents: "none" }} />

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

      <div className="absolute top-0 right-0 flex flex-col gap-1.5 bg-card/80 rounded-lg p-2 border border-border">
        <div className="flex items-center gap-1.5">
          <div className="flex gap-px rounded-sm overflow-hidden" style={{ width: 20, height: 6 }}>
            {agents.slice(0, 6).map((a, i) => (
              <div key={i} style={{ flex: 1, backgroundColor: a.color, opacity: 0.8 }} />
            ))}
            {agents.length === 0 && <div style={{ flex: 1, backgroundColor: "#FFD700", opacity: 0.7 }} />}
          </div>
          <span className="text-[9px] text-muted-foreground">Coverage</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: "rgba(255,140,0,0.9)" }} />
          <span className="text-[9px] text-muted-foreground">Up for grabs</span>
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

// ─────────────────────────────────────────────────────────────────────────────
function ShiftLever({
  agent, shift, leverState, onLeverChange,
  highlighted, onHighlight, onUnhighlight,
  baseHours, overtimeHours, releasedHours, isAdmin, utcHour, selectedDay,
}: {
  agent: Agent; shift: Shift | undefined;
  leverState: LeverState | undefined;
  onLeverChange: (id: number, start: number, end: number) => void;
  highlighted: boolean; onHighlight: () => void; onUnhighlight: () => void;
  baseHours: number; overtimeHours: number; releasedHours: number;
  isAdmin: boolean; utcHour: number; selectedDay: number;
}) {
  if (!shift || !leverState) return null;

  const { startUtc, endUtc } = shift;
  const { activeStart, activeEnd } = leverState;
  const resolved = resolveShift(startUtc, endUtc, activeStart, activeEnd, shift.breakStart ?? null);

  const isToday = selectedDay === getUTCDay();
  const { pct, otPct } = isToday
    ? shiftProgress(startUtc, endUtc, activeStart, activeEnd, utcHour)
    : { pct: 0, otPct: 0 };

  const barMax    = 24;
  const normEnd   = normaliseEndUtc(startUtc, endUtc);
  const baseLeft  = (startUtc / barMax) * 100;
  const baseWidth = (resolved.baseDuration / barMax) * 100;
  const actLeft   = (activeStart / barMax) * 100;
  const actWidth  = (resolved.activeDuration / barMax) * 100;

  const adjustEnd   = (delta: number) => { if (!isAdmin) return; onLeverChange(shift.id, activeStart, Math.max(activeStart + 0.5, Math.min(48, activeEnd + delta))); };
  const adjustStart = (delta: number) => { if (!isAdmin) return; onLeverChange(shift.id, Math.max(0, Math.min(activeEnd - 0.5, activeStart + delta)), activeEnd); };

  const barRef   = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ type: "start" | "end" | "move"; startX: number; startVal: number; startEnd: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent, type: "start" | "end" | "move") => {
    if (!isAdmin) return;
    e.preventDefault();
    dragging.current = { type, startX: e.clientX, startVal: activeStart, startEnd: activeEnd };
    const snap = (h: number) => Math.round(h * 2) / 2;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !barRef.current) return;
      const rect  = barRef.current.getBoundingClientRect();
      const delta = ((ev.clientX - dragging.current.startX) / rect.width) * 24;
      const { type: t, startVal, startEnd } = dragging.current;
      if (t === "start") {
        const ns = snap(Math.max(0, Math.min(startEnd - 0.5, startVal + delta)));
        onLeverChange(shift.id, ns, startEnd);
      } else if (t === "end") {
        const ne = snap(Math.max(startVal + 0.5, Math.min(48, startEnd + delta)));
        onLeverChange(shift.id, startVal, ne);
      } else {
        const dur = startEnd - startVal;
        const ns  = snap(Math.max(0, Math.min(48 - dur, startVal + delta)));
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
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
          <span className="text-xs font-medium truncate max-w-[80px]">{agent.name}</span>
          {isToday && pct > 0 && (
            <span className="text-[11px] px-1 py-0.5 rounded font-mono font-bold"
              style={{ backgroundColor: agent.color + "25", color: agent.color }}>
              {pct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {resolved.hasOvertime && formatDuration(resolved.overtimeHours) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium"
              style={{ background: agent.color + "30", color: agent.color }}>
              +{formatDuration(resolved.overtimeHours)} OT
              {isToday && otPct > 0 && <span className="ml-1 opacity-70">{otPct}%</span>}
            </span>
          )}
          {resolved.hasShrink && formatDuration(resolved.shrinkHours) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium bg-orange-500/20 text-orange-400">
              -{formatDuration(resolved.shrinkHours)} free
            </span>
          )}
          {shift.breakStart != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium bg-muted text-muted-foreground"
              title={`Break at ${formatUtcHour(shift.breakStart)} UTC`}>
              ☕ {formatUtcHour(shift.breakStart)}
            </span>
          )}
        </div>
      </div>

      {isToday && pct > 0 && (
        <div className="mb-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(100, pct)}%`, backgroundColor: agent.color, opacity: 0.7 }}
          />
        </div>
      )}

      <div ref={barRef} className="relative h-5 bg-muted rounded-sm overflow-visible mb-2 select-none">
        <div className="absolute h-full rounded-sm opacity-20"
          style={{ left: `${baseLeft}%`, width: `${baseWidth}%`, backgroundColor: agent.color }}
        />
        {resolved.hasShrink && (
          <div className="absolute h-3 top-1 rounded-sm"
            style={{
              left: `${(activeEnd / barMax) * 100}%`,
              width: `${(resolved.shrinkHours / barMax) * 100}%`,
              background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.6) 0px,rgba(255,140,0,0.6) 3px,transparent 3px,transparent 6px)",
            }}
          />
        )}
        <div className="absolute h-full rounded-sm transition-none"
          style={{
            left: `${actLeft}%`,
            width: `${Math.max(1, Math.min(actWidth, resolved.hasOvertime ? actWidth : baseWidth))}%`,
            backgroundColor: agent.color,
            opacity: resolved.hasOvertime ? 0.9 : resolved.hasShrink ? 0.55 : 0.75,
            boxShadow: resolved.hasOvertime ? `0 0 6px white, 0 0 10px ${agent.color}` : undefined,
            cursor: isAdmin ? "grab" : "default",
          }}
          onMouseDown={e => onMouseDown(e, "move")}
        />
        {resolved.hasOvertime && (
          <div className="absolute h-full rounded-sm"
            style={{
              left: `${(normEnd / barMax) * 100}%`,
              width: `${((activeEnd - normEnd) / barMax) * 100}%`,
              backgroundColor: agent.color,
              boxShadow: `0 0 6px white, 0 0 10px ${agent.color}`,
            }}
          />
        )}
        {shift.breakStart != null && (() => {
          const bkLeft  = (shift.breakStart / barMax) * 100;
          const bkWidth = (0.5 / barMax) * 100;
          return (
            <div className="absolute top-0 bottom-0 z-20 rounded-sm flex items-center justify-center"
              style={{ left: `${bkLeft}%`, width: `${Math.max(1.5, bkWidth)}%`, backgroundColor: "rgba(255,255,255,0.92)" }}
              title={`Break: ${formatUtcHour(shift.breakStart)}–${formatUtcHour(shift.breakStart + 0.5)}`}
            >
              <span style={{ fontSize: 6, lineHeight: 1 }}>☕</span>
            </div>
          );
        })()}
        {isAdmin && (
          <div className="absolute top-0 bottom-0 w-2 rounded-l-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `${actLeft}%` }}
            onMouseDown={e => onMouseDown(e, "start")}
          />
        )}
        {isAdmin && (
          <div className="absolute top-0 bottom-0 w-2 rounded-r-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `calc(${actLeft}% + ${Math.max(1, actWidth)}% - 8px)` }}
            onMouseDown={e => onMouseDown(e, "end")}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {isAdmin && <button onClick={() => adjustStart(-0.5)} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier start">← 30m</button>}
          {isAdmin && <button onClick={() => adjustStart(0.5)}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later start">30m →</button>}
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeStart)}</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{formatDuration(resolved.activeDuration)}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeEnd)}</span>
          {isAdmin && <button onClick={() => adjustEnd(-0.5)} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier end">← 30m</button>}
          {isAdmin && <button onClick={() => adjustEnd(0.5)}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later end">30m →</button>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
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
                <span className="text-muted-foreground ml-1">{formatDuration(activeHours)}</span>
                {overtimeHours > 0 && <span className="ml-1" style={{ color: agent.color }}>+{formatDuration(overtimeHours)} OT</span>}
                {releasedHours > 0 && <span className="ml-1 text-orange-400">{formatDuration(releasedHours)} up for grabs</span>}
              </div>
            </div>
          );
        })}
      </div>
      {(totalOvertimeHours > 0 || totalReleasedHours > 0) && (
        <div className="mt-2 pt-2 border-t border-border">
          {totalOvertimeHours > 0 && <p className="text-[10px] text-primary">Total overtime: +{formatDuration(totalOvertimeHours)}</p>}
          {totalReleasedHours > 0 && <p className="text-[10px] text-orange-400">Total up for grabs: {formatDuration(totalReleasedHours)}</p>}
        </div>
      )}
    </div>
  );
}
