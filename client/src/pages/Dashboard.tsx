import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift, OvertimeLog } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RotateCcw, Clock, AlignLeft, Lock, CalendarRange, X, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { useSoothingSounds } from "@/hooks/useSoothingSounds";
import { toast } from "@/hooks/use-toast";
import { useAgentSession } from "@/App";
import {
  clampShiftWindow,
  segmentShift,
  resolveShift,
  shiftProgress,
  calcCoverageForDay,
  formatUtcHour,
  formatDuration,
  shiftLabel,
  shiftDuration,
  normaliseEndUtc,
  displayHour,
  getActiveClaimForShift,
  isCoverageClaim,
  shiftHasOverride,
} from "@/lib/shiftUtils";

// Reusable drag-scroll hook with PointerCapture
const useDragScroll = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const dragged = useRef(false);
  const DRAG_THRESHOLD = 5;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    ref.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startX.current = e.pageX - ref.current.offsetLeft;
    scrollLeft.current = ref.current.scrollLeft;
    dragged.current = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !ref.current) return;
    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - startX.current) * 2.5;
    if (Math.abs(walk) > DRAG_THRESHOLD) dragged.current = true;
    ref.current.scrollLeft = scrollLeft.current - walk;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    ref.current.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    dragged.current = false;
  };

  const stopDrag = (e: React.PointerEvent) => {
    if (dragged.current) e.stopPropagation();
  };

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: onPointerUp,
    stopDrag,
    isDragging,
  };
};

const DAYS   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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

interface DayDesc {
  date: string;
  dayOfWeek: number;
  label: string;
  dateLabel: string;
  isToday: boolean;
  dayIndex: number;
}

interface GapRange {
  start: number;
  end: number;
}

interface GapSlice {
  startUtc: number;
  endUtc: number;
}

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatDayMonth(value: Date | string): string {
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  return `${date.getUTCDate().toString().padStart(2, "0")}/${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function formatWeekdayWithDate(dayOfWeek: number, date: string): string {
  return `${DAYS[dayOfWeek]} ${formatDayMonth(date)}`;
}

function formatWeekdayLongWithDate(dayOfWeek: number, date: string): string {
  return `${DAY_FULL[dayOfWeek]} ${formatDayMonth(date)}`;
}

function findGapRanges(coverage: number[]): GapRange[] {
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

function expandGapRangesToSlices(ranges: GapRange[]): GapSlice[] {
  return ranges.flatMap((range) => {
    const slices: GapSlice[] = [];
    for (let hour = range.start; hour < range.end; hour++) {
      slices.push({ startUtc: hour, endUtc: hour + 1 });
    }
    return slices;
  });
}

function buildDays(pastDays: number, futureDays: number, anchor = new Date()): DayDesc[] {
  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const result: DayDesc[] = [];
  const total = pastDays + 1 + futureDays;
  for (let i = 0; i < total; i++) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - pastDays + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dow     = d.getUTCDay();
    result.push({
      date: dateStr,
      dayOfWeek: dow,
      label: DAYS[dow],
      dateLabel: formatDayMonth(d),
      isToday: dateStr === todayStr,
      dayIndex: i,
    });
  }
  return result;
}

function buildWeekCycleDays(anchorDate: string): DayDesc[] {
  const anchor = parseIsoDate(anchorDate);
  const start = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());

  const todayStr = new Date().toISOString().slice(0, 10);
  return Array.from({ length: 8 }, (_, dayIndex) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + dayIndex);
    const date = d.toISOString().slice(0, 10);
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

function resolveDateForWeekday(dayOfWeek: number, anchor = new Date()): string {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + (dayOfWeek - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function AgentBreakControl({
  isOnBreak,
  startedAt,
  onBreakStart,
  onBreakEnd,
}: {
  isOnBreak: boolean;
  startedAt: number | null;
  onBreakStart: () => void;
  onBreakEnd: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 60000));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <div className="mb-3">
      <button
        onClick={isOnBreak ? onBreakEnd : onBreakStart}
        className={cn(
          "w-full text-[10px] py-1.5 rounded border transition-colors flex items-center justify-center gap-1",
          isOnBreak
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {isOnBreak ? `☕ ${elapsed}m · I'm back` : "☕ Take break"}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const isAdmin = useAdminMode();
  const agentSession = useAgentSession();
  const { playSoftClick, playDragWhoosh, playSuccess, playBreakStart } = useSoothingSounds();
  const selectedDateAnchor = (date: string) => parseIsoDate(date);

  const initDate = () => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return dateParam;
    return resolveDateForWeekday(initDay());
  };

  const initDay = () => {
    // Support ?day=N query param from overtime page navigation
    const params = new URLSearchParams(window.location.search);
    const dayParam = params.get("day");
    if (dayParam != null) {
      const d = parseInt(dayParam, 10);
      if (d >= 0 && d <= 6) return d;
    }
    return getUTCDay();
  };

  const initScope = (): "day" | "multi" => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("scope") === "multi") return "multi";
    return (localStorage.getItem("shiftclock:timelineScope") as "day" | "multi") ?? "day";
  };

  const initFocusHour = (): number | null => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("focusHour");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const initFocusAgentId = (): number | null => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("focusAgentId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const [selectedDay,    setSelectedDay]    = useState<number>(initDay);
  const [selectedDate,   setSelectedDate]   = useState<string>(initDate);
  const [weekAnchorDate, setWeekAnchorDate] = useState<string>(initDate);
  const [visible,        setVisible]        = useState<Set<number>>(new Set());
  const [highlighted,    setHighlighted]    = useState<number | null>(initFocusAgentId);
  const [leverState,     setLeverState]     = useState<Record<number, LeverState>>({});
  const pendingCommit = useRef<Set<number>>(new Set());
  const [utcHour,        setUtcHour]        = useState(getUTCHour());
  const [viewMode,       setViewMode]       = useState<"clock" | "timeline">(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("day")) return "timeline";
    return (localStorage.getItem("shiftclock:viewMode") as "clock" | "timeline") ?? "clock";
  });
  const [timelineScope,  setTimelineScope]  = useState<"day" | "multi">(initScope);
  const [focusHour] = useState<number | null>(initFocusHour);
  const [tooltipInfo,    setTooltipInfo]    = useState<{ agent: Agent; shift: Shift; x: number; y: number; pct: number; otPct: number } | null>(null);

  const todayDateStr = new Date().toISOString().slice(0, 10);
  const isSelectedDateToday = selectedDate === todayDateStr;
  const canClaimCoverage = isAdmin || Boolean(agentSession);

  // Persist view mode so the sidebar can restore it on next mount
  useEffect(() => { localStorage.setItem("shiftclock:viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("shiftclock:timelineScope", timelineScope); }, [timelineScope]);

  // Listen for view-change events dispatched by the sidebar
  useEffect(() => {
    const handler = (e: Event) => {
      const { mode, scope } = (e as CustomEvent<{ mode: "clock" | "timeline"; scope?: "day" | "multi" }>).detail;
      setViewMode(mode);
      if (scope) setTimelineScope(scope);
    };
    window.addEventListener("shiftclock:viewchange", handler);
    return () => window.removeEventListener("shiftclock:viewchange", handler);
  }, []);
  const canEditAgentLane = (agentId: number) => isAdmin || agentSession?.agentId === agentId;

  const openOvertimeForRecord = (record: OvertimeLog) => {
    const params = new URLSearchParams();
    params.set("otId", String(record.id));
    params.set("date", record.date);
    params.set("day", String(record.dayOfWeek));
    if (record.coverStartUtc != null) params.set("focusHour", String(record.coverStartUtc));
    params.set("focusAgentId", String(record.agentId));
    window.location.href = `${window.location.pathname}?${params.toString()}#/overtime`;
  };

  const { data: agents    = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"], refetchInterval: 30_000, staleTime: Infinity });
  const { data: allShifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"], refetchInterval: 15_000 });
  const { data: otRecords = [] } = useQuery<OvertimeLog[]>({ queryKey: ["/api/overtime"], refetchInterval: 15_000 });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Shift> & { date?: string } }) =>
      apiRequest("PATCH", `/api/shifts/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }),
    onError: (error) => {
      toast({
        title: "Failed to update shift",
        description: errorMessageFromUnknown(error),
        variant: "destructive",
      });
    },
  });

  const resetDayMutation = useMutation({
    mutationFn: ({ date, dayOfWeek }: { date: string; dayOfWeek: number }) =>
      apiRequest("POST", "/api/shifts/reset-day", { date, dayOfWeek }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
    },
  });

  const breakStartMutation = useMutation({
    mutationFn: (agentId: number) => apiRequest("POST", `/api/agents/${agentId}/break/start`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
  });

  const breakEndMutation = useMutation({
    mutationFn: (agentId: number) => apiRequest("POST", `/api/agents/${agentId}/break/end`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
  });

    const bulkDeleteOTMutation = useMutation({
      mutationFn: (ids: number[]) => apiRequest("DELETE", "/api/overtime", { ids }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
        queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      },
    });

    const [confirmReset, setConfirmReset] = useState(false);
    const confirmResetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (agents.length > 0 && visible.size === 0)
      setVisible(new Set(agents.map(a => a.id)));
  }, [agents]);

  const prevBreakRef = useRef<Map<number, string | null>>(new Map());
  useEffect(() => {
    if (!agents.length) return;
    const prev = prevBreakRef.current;
    if (prev.size === 0) {
      prevBreakRef.current = new Map(agents.map(a => [a.id, a.breakActiveAt ?? null]));
      return;
    }
    const ownId = agentSession?.agentId ?? null;
    const onBreak: Agent[] = [], back: Agent[] = [];
    for (const a of agents) {
      const p = prev.get(a.id) ?? null, c = a.breakActiveAt ?? null;
      if (p === null && c !== null && a.id !== ownId) onBreak.push(a);
      if (p !== null && c === null && a.id !== ownId) back.push(a);
    }
    onBreak.forEach((a, i) =>
      setTimeout(() => { toast({ title: `☕ ${a.name} is on break`, duration: 4000 }); playBreakStart(); }, i * 300)
    );
    if (back.length === 1) toast({ title: `✓ ${back[0].name} is back`, duration: 3000 });
    else if (back.length > 1) toast({ title: `✓ ${back.map(a => a.name).join(", ")} are back`, duration: 3000 });
    prevBreakRef.current = new Map(agents.map(a => [a.id, a.breakActiveAt ?? null]));
  }, [agents]);

  useEffect(() => {
    const t = setInterval(() => setUtcHour(getUTCHour()), 1000);
    return () => clearInterval(t);
  }, []);

  const todayShifts = allShifts.filter(s => s.dayOfWeek === selectedDay);

  useEffect(() => {
    const next: Record<number, LeverState> = {};
    for (const s of allShifts) {
      const normEnd = normaliseEndUtc(s.startUtc, s.endUtc);
      // Only overwrite local lever state if this shift is NOT mid-drag/pending
      if (!pendingCommit.current.has(s.id)) {
        next[s.id] = {
          activeStart: s.activeStart ?? s.startUtc,
          activeEnd: s.activeEnd ?? normEnd,
        };
      }
    }
    setLeverState(prev => ({ ...prev, ...next }));
  }, [allShifts]);

  const updateSelectedDay = (
    dayOfWeek: number,
    date = resolveDateForWeekday(dayOfWeek, selectedDate ? selectedDateAnchor(selectedDate) : new Date())
  ) => {
    setSelectedDay(dayOfWeek);
    setSelectedDate(date);
  };

  const shiftDateByDays = (date: string, days: number): string => {
    const d = parseIsoDate(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const goToPreviousWeek = () => {
    playSoftClick();
    const prevAnchor = shiftDateByDays(weekAnchorDate, -7);
    setWeekAnchorDate(prevAnchor);
    const prevSelected = shiftDateByDays(selectedDate, -7);
    updateSelectedDay(parseIsoDate(prevSelected).getUTCDay(), prevSelected);
  };

  const goToNextWeek = () => {
    playSoftClick();
    const nextAnchor = shiftDateByDays(weekAnchorDate, 7);
    setWeekAnchorDate(nextAnchor);
    const nextSelected = shiftDateByDays(selectedDate, 7);
    updateSelectedDay(parseIsoDate(nextSelected).getUTCDay(), nextSelected);
  };

  const previewLeverChange = (id: number, start: number, end: number) => {
    const next = clampShiftWindow(start, end);
    pendingCommit.current.add(id);
    setLeverState((prev) => ({ ...prev, [id]: next }));
  };

  const commitLeverChange = (agent: Agent, shift: Shift, start: number, end: number) => {
    const next = clampShiftWindow(start, end);
    const normEnd = normaliseEndUtc(shift.startUtc, shift.endUtc);
    const serverStart = shift.activeStart ?? shift.startUtc;
    const serverEnd = shift.activeEnd ?? normEnd;

    setLeverState((prev) => ({ ...prev, [shift.id]: next }));

    if (next.activeStart === serverStart && next.activeEnd === serverEnd) {
      pendingCommit.current.delete(shift.id);
      return;
    }

    playSuccess();
    updateShiftMutation.mutate({
      id: shift.id,
      data: { activeStart: next.activeStart, activeEnd: next.activeEnd, date: selectedDate },
    }, {
      onSettled: () => { pendingCommit.current.delete(shift.id); },
    });

    if (next.activeEnd > normEnd) {
      logActivityMutation.mutate({
        agentId: agent.id,
        date: selectedDate,
        type: "overtime",
        actionType: "overtime-extended",
        description: `${agent.name} extended their ${formatWeekdayWithDate(selectedDay, selectedDate)} shift by ${formatDuration(next.activeEnd - normEnd)}.`,
      });
    } else if (next.activeEnd < normEnd) {
      logActivityMutation.mutate({
        agentId: agent.id,
        date: selectedDate,
        type: "shift-freed",
        actionType: "shift-freed",
        description: `${agent.name} freed ${formatDuration(normEnd - next.activeEnd)} of their ${formatWeekdayWithDate(selectedDay, selectedDate)} shift. Now up for grabs.`,
      });
    }
  };

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
    })
    .concat(
      otRecords
        .filter(
          (record) =>
            visible.has(record.agentId) &&
            isCoverageClaim(record) &&
            (record.status === "approved" || record.status === "paid") &&
            record.dayOfWeek === selectedDay &&
            record.coverStartUtc != null &&
            record.coverEndUtc != null
        )
        .map((record) => ({
          activeStart: record.coverStartUtc!,
          activeEnd: record.coverEndUtc!,
        }))
    );
  const coverage    = calcCoverageForDay(coverageInput);

  const agentSummaries = agents.map(agent => {
    const agentTodayShifts = todayShifts.filter(s => s.agentId === agent.id);
    const approvedClaims = otRecords.filter(
      (record) =>
        record.agentId === agent.id &&
        isCoverageClaim(record) &&
        (record.status === "approved" || record.status === "paid") &&
        record.dayOfWeek === selectedDay &&
        record.coverStartUtc != null &&
        record.coverEndUtc != null
    );
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

      // Also include pending claim hours as "released"
      const activeClaimForShift = getActiveClaimForShift(s, otRecords, selectedDay);
      if (activeClaimForShift) {
        releasedHours += (activeClaimForShift.coverEndUtc! - activeClaimForShift.coverStartUtc!);
      }
    }
    for (const claim of approvedClaims) {
      const claimHours = claim.coverEndUtc! - claim.coverStartUtc!;
      activeHours += claimHours;
      overtimeHours += claimHours;
    }
    return { agent, baseHours, activeHours, overtimeHours, releasedHours, shifts: agentTodayShifts };
  });

  const zeroCoverageHours  = coverage.filter(c => c === 0).length;
  const gapRanges          = findGapRanges(coverage);
  const gapSlices          = expandGapRangesToSlices(gapRanges);
  const peakCoverageHour   = coverage.indexOf(Math.max(...coverage));
  const totalOvertimeHours = agentSummaries.reduce((a, s) => a + s.overtimeHours, 0);
  const totalReleasedHours = agentSummaries.reduce((a, s) => a + s.releasedHours, 0);
  const pendingCoverageClaims = otRecords.filter(
    (record) =>
      isCoverageClaim(record) &&
      record.status === "pending" &&
      record.dayOfWeek === selectedDay &&
      record.coverStartUtc != null &&
      record.coverEndUtc != null
  );

  const todayUTCDay  = getUTCDay();
  const onlineAgents = agents.filter(agent => {
    if (!isSelectedDateToday) return false;
    const isOnShift = todayShifts.some(s => {
      if (s.agentId !== agent.id) return false;
      const ls    = leverState[s.id];
      const start = ls?.activeStart ?? s.startUtc;
      const end   = ls?.activeEnd   ?? normaliseEndUtc(s.startUtc, s.endUtc);
      if (end <= 24) return utcHour >= start && utcHour <= end;
      return utcHour >= start || utcHour <= (end - 24);
    });
    if (isOnShift) return true;

    return otRecords.some((record) => {
      if (record.agentId !== agent.id) return false;
      if (!isCoverageClaim(record)) return false;
      if (record.status !== "approved" && record.status !== "paid") return false;
      if (record.dayOfWeek !== selectedDay) return false;
      if (record.coverStartUtc == null || record.coverEndUtc == null) return false;

      const end = normaliseEndUtc(record.coverStartUtc, record.coverEndUtc);
      if (end <= 24) return utcHour >= record.coverStartUtc && utcHour <= end;
      return utcHour >= record.coverStartUtc || utcHour <= (end - 24);
    });
  });

  const agentsOnBreak = agents.filter(a => a.breakActiveAt != null && visible.has(a.id));

  const hasShiftsToday = todayShifts.length > 0;
  const isWeekend      = selectedDay === 0 || selectedDay === 6;

  const handleUndoDay = () => {
      if (!confirmReset) {
        setConfirmReset(true);
        clearTimeout(confirmResetTimer.current);
        confirmResetTimer.current = setTimeout(() => setConfirmReset(false), 3500);
        return;
      }
      clearTimeout(confirmResetTimer.current);
      setConfirmReset(false);

      // Optimistically reset lever state for visual immediacy
      const reset: Record<number, LeverState> = { ...leverState };
      for (const s of todayShifts) {
        const normEnd = normaliseEndUtc(s.startUtc, s.endUtc);
        reset[s.id] = { activeStart: s.startUtc, activeEnd: normEnd };
      }
      setLeverState(reset);

      resetDayMutation.mutate({ date: selectedDate, dayOfWeek: selectedDay });
      toast({ title: `${selectedDayShortLabel} reset to base schedule` });
    };

  const isMulti    = viewMode === "timeline" && timelineScope === "multi";
  const isTimeline = viewMode === "timeline";

  // Assign overtime modal state
  const [assignModal, setAssignModal] = useState<
    | {
        kind: "shift";
        shift: Shift;
        fromAgent: Agent;
        dayOfWeek: number;
        date: string;
        startUtc: number;
        endUtc: number;
        freedHours: number;
      }
    | {
        kind: "gap";
        dayOfWeek: number;
        date: string;
        startUtc: number;
        endUtc: number;
        freedHours: number;
      }
    | null
  >(null);

  const assignOvertimeMutation = useMutation({
    mutationFn: (body: {
      fromShiftId?: number;
      toAgentId: number;
      hours: number;
      date: string;
      dayOfWeek: number;
      coverStartUtc?: number;
      coverEndUtc?: number;
    }) =>
      apiRequest("POST", "/api/overtime/assign", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      setAssignModal(null);
      playSuccess();
    },
    onError: (error) => {
      const message = errorMessageFromUnknown(error);
      if (message.toLowerCase().includes("already joined")) {
        toast({
          title: "Already in line",
          description: "You already have a pending request for this coverage slot.",
        });
        return;
      }
      toast({
        title: "Join line failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const logActivityMutation = useMutation({
    mutationFn: (body: { agentId: number; date: string; type: string; actionType: string; description: string }) =>
      apiRequest("POST", "/api/agent-logs", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] }),
    onError: (error) => {
      toast({
        title: "Failed to write activity log",
        description: errorMessageFromUnknown(error),
        variant: "destructive",
      });
    },
  });

  const openAssignModal = (shift: Shift, agent: Agent, freedHours: number, segStart?: number, segEnd?: number, segDayOffset?: number) => {
    if (!canClaimCoverage) return;
    if (assignOvertimeMutation.isPending) return;
    playSoftClick();
    const normEnd = normaliseEndUtc(shift.startUtc, shift.endUtc);
    const activeEnd = leverState[shift.id]?.activeEnd ?? shift.activeEnd ?? normEnd;

    // Use explicit segment coords when provided (e.g. start-shrink freed time)
    const slotStart = segStart ?? activeEnd;
    const slotEnd   = segEnd   ?? activeEnd + freedHours;

    // Overnight freed segments that cross midnight belong to the next calendar day
    const dayOff = segDayOffset ?? 0;
    const claimDayOfWeek = dayOff > 0 ? (shift.dayOfWeek + dayOff) % 7 : shift.dayOfWeek;
    const claimDate = dayOff > 0 ? (() => {
      const d = new Date(selectedDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + dayOff);
      return d.toISOString().slice(0, 10);
    })() : selectedDate;

    if (!isAdmin && agentSession) {
      assignOvertimeMutation.mutate({
        fromShiftId: shift.id,
        toAgentId: agentSession.agentId,
        hours: freedHours,
        date: claimDate,
        dayOfWeek: claimDayOfWeek,
        coverStartUtc: slotStart,
        coverEndUtc: slotEnd,
      });
      return;
    }

    setAssignModal({
      kind: "shift",
      shift,
      fromAgent: agent,
      dayOfWeek: claimDayOfWeek,
      date: claimDate,
      startUtc: slotStart,
      endUtc: slotEnd,
      freedHours,
    });
  };

  const openGapAssignModal = (startUtc: number, endUtc: number, dayOfWeek = selectedDay, date = selectedDate) => {
    if (!canClaimCoverage || endUtc <= startUtc) return;
    if (assignOvertimeMutation.isPending) return;
    playSoftClick();

    if (!isAdmin && agentSession) {
      assignOvertimeMutation.mutate({
        toAgentId: agentSession.agentId,
        hours: endUtc - startUtc,
        date,
        dayOfWeek,
        coverStartUtc: startUtc,
        coverEndUtc: endUtc,
      });
      return;
    }

    setAssignModal({
      kind: "gap",
      dayOfWeek,
      date,
      startUtc,
      endUtc,
      freedHours: endUtc - startUtc,
    });
  };

  const selectedDayShortLabel = formatWeekdayWithDate(selectedDay, selectedDate);
  const weekCycleDays = buildWeekCycleDays(weekAnchorDate);

  const commitBreakChange = (agent: Agent, shift: Shift, breakStart: number | null) => {
    if (!canEditAgentLane(agent.id)) return;
    const nextBreak = breakStart == null ? null : Math.round(breakStart * 2) / 2;
    const currentBreak = shift.breakStart ?? null;
    if (currentBreak === nextBreak) return;

    updateShiftMutation.mutate({
      id: shift.id,
      data: { breakStart: nextBreak },
    });

    logActivityMutation.mutate({
      agentId: agent.id,
      date: selectedDate,
      type: "break",
      actionType: "break-updated",
      description: nextBreak == null
        ? `${agent.name} removed their break on ${formatWeekdayWithDate(selectedDay, selectedDate)}.`
        : `${agent.name} set break at ${formatUtcHour(nextBreak)} UTC on ${formatWeekdayWithDate(selectedDay, selectedDate)}.`,
    });
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Header ── */}
        <header className="shrink-0 border-b border-border bg-card/50 backdrop-blur px-3 py-2 sm:px-4 lg:px-6">
          <div className="flex flex-wrap items-center gap-2 md:grid md:grid-cols-[auto_1fr_auto]">
            <div className="flex items-center gap-2 sm:gap-3">
            <h1 className="text-sm font-semibold">Coverage Command</h1>
            <Badge variant="outline" className="text-primary border-primary/30 text-xs font-mono">UTC</Badge>
            </div>

          {/* Day nav — hidden in multi-day timeline */}
            {!isMulti && (
              <div className="order-3 w-full md:order-none md:w-auto md:flex md:justify-center">
                <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
              <button
                onClick={goToPreviousWeek}
                className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Previous week"
                data-testid="week-prev"
              >
                <ChevronLeft size={14} />
              </button>
              {weekCycleDays.map((day) => {
                const hasShifts = allShifts.some(s => s.dayOfWeek === day.dayOfWeek);
                const isSelected = selectedDate === day.date;
                return (
                  <button key={day.date} onClick={() => { playSoftClick(); updateSelectedDay(day.dayOfWeek, day.date); }} data-testid={`day-${day.date}`}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-all relative min-w-[58px] shrink-0",
                      isSelected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <span className="flex flex-col leading-tight">
                      <span>{day.label}</span>
                      <span className={cn("text-[10px] font-mono", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>{day.dateLabel}</span>
                    </span>
                    {hasShifts && !isSelected && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary/50" />
                    )}
                  </button>
                );
              })}
              <button
                onClick={goToNextWeek}
                className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Next week"
                data-testid="week-next"
              >
                <ChevronRight size={14} />
              </button>
                </div>
            </div>
          )}

            {isMulti && (
              <span className="order-3 w-full text-[11px] text-muted-foreground font-mono md:order-none md:w-auto md:text-center">14-day view · scroll to navigate · click day label → Day view</span>
            )}
            {/* right spacer keeps day picker centred in 3-col grid */}
            <div className="hidden md:block" />
          </div>
        </header>

        {/* ── Online now bar — clock + day timeline only ── */}
        {!isMulti && isSelectedDateToday && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4 lg:px-6 border-b border-border bg-card/20 shrink-0">
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
                {agentsOnBreak.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    ☕ {agentsOnBreak.length} on break
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Main content ── */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ── Timeline modes (day + multi): full-bleed, no centering wrapper ── */}
          {isTimeline ? (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <UnifiedTimeline
                scope={isMulti ? "multi" : "day"}
                agents={agents}
                allShifts={allShifts}
                otRecords={otRecords}
                isAdmin={isAdmin}
                agentSessionId={agentSession?.agentId ?? null}
                visible={visible}
                highlighted={highlighted}
                setHighlighted={setHighlighted}
                leverState={leverState}
                utcHour={utcHour}
                selectedDay={selectedDay}
                selectedDate={selectedDate}
                focusHour={focusHour}
                onSelectDay={(dow, date) => {
                  updateSelectedDay(dow, date);
                  if (isMulti) setTimelineScope("day");
                }}
                toggleVisible={toggleVisible}
                toggleAll={toggleAll}
                onAssignOvertime={openAssignModal}
                onAssignGap={openGapAssignModal}
                onOpenOvertime={openOvertimeForRecord}
              />
            </div>
          ) : (
            /* ── Clock mode: centred layout + right panel ── */
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
              <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 overflow-hidden min-w-0 relative min-h-[220px]">
                {!hasShiftsToday ? (
                    <EmptyState
                      isWeekend={isWeekend}
                      dayLabel={selectedDayShortLabel}
                      canClaimCoverage={canClaimCoverage}
                      gapSlices={gapSlices}
                      onAssignGap={openGapAssignModal}
                    />
                ) : (
                  <ClockVisualizer
                    agents={agents}
                    shifts={todayShifts}
                    isAdmin={isAdmin}
                    visible={visible}
                    highlighted={highlighted}
                    setHighlighted={setHighlighted}
                    leverState={leverState}
                    utcHour={utcHour}
                    coverage={coverage}
                    otRecords={otRecords}
                    tooltipInfo={tooltipInfo}
                    setTooltipInfo={setTooltipInfo}
                    selectedDay={selectedDay}
                    agentSessionId={agentSession?.agentId ?? null}
                    onAssignOvertime={openAssignModal}
                    onAssignGap={openGapAssignModal}
                    onOpenOvertime={openOvertimeForRecord}
                  />
                )}

                {hasShiftsToday && (
                  <div className="flex flex-wrap gap-1.5 justify-center mt-3 max-w-2xl">
                    <button onClick={toggleAll}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all">
                      {visible.size === agents.length ? "Hide all" : "Show all"}
                    </button>
                    {agents.map(agent => {
                      const isOnBreak = Boolean(agent.breakActiveAt) && visible.has(agent.id);
                      return (
                      <button key={agent.id}
                        onClick={() => toggleVisible(agent.id)}
                        onMouseEnter={() => setHighlighted(agent.id)}
                        onMouseLeave={() => setHighlighted(null)}
                        data-testid={`toggle-agent-${agent.id}`}
                        className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all duration-150",
                          visible.has(agent.id) ? (isOnBreak ? "opacity-60" : "opacity-100") : "opacity-40 grayscale"
                        )}
                        style={{
                          borderColor: agent.color + "60",
                          backgroundColor: visible.has(agent.id) ? agent.color + "20" : "transparent",
                          color: visible.has(agent.id) ? agent.color : "hsl(var(--muted-foreground))",
                          boxShadow: highlighted === agent.id ? `0 0 8px ${agent.color}50` : undefined,
                        }}
                      >
                        {agent.name}{isOnBreak ? " ☕" : ""}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right panel */}
              <div className="w-full md:w-64 lg:w-72 xl:w-80 flex flex-col border-t md:border-t-0 md:border-l border-border overflow-y-auto shrink-0 md:min-h-0 max-h-[45vh] md:max-h-none">
                <div className="grid grid-cols-3 border-b border-border shrink-0">
                  <KpiCell label="No Cover" value={`${zeroCoverageHours}h`} warn={zeroCoverageHours > 0} />
                  <KpiCell label="Peak Hr"  value={peakCoverageHour.toString().padStart(2, "0") + ":00"} />
                  <KpiCell label="Overtime" value={totalOvertimeHours > 0 ? `+${formatDuration(totalOvertimeHours)}` : "+0"} accent={totalOvertimeHours > 0} />
                </div>

                <div className="relative flex-1 min-h-0">
                  <div className="absolute inset-0 overflow-y-auto overscroll-contain p-2 sm:p-3 space-y-1.5" id="lever-scroll">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Shift Levers · {selectedDayShortLabel}</p>
                        {!isAdmin && !agentSession && (
                          <span className="flex items-center gap-1 text-[9px] text-muted-foreground border border-border rounded px-1 py-0.5">
                            <Lock size={8} /> View-only
                          </span>
                        )}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={handleUndoDay}
                          className={cn(
                            "text-[10px] flex items-center gap-1 transition-colors select-none",
                            confirmReset
                              ? "text-destructive hover:text-destructive font-semibold"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          title={confirmReset ? "Click again to confirm reset" : "Reset levers and pending OT for this day"}
                        >
                          <RotateCcw size={10} />
                          {confirmReset ? "Confirm reset?" : "Reset day"}
                        </button>
                      )}
                    </div>

                    {agentSession && (() => {
                      const own = agents.find(a => a.id === agentSession.agentId);
                      const isOnBreak = Boolean(own?.breakActiveAt);
                      const startedAt = own?.breakActiveAt ? new Date(own.breakActiveAt).getTime() : null;
                      return (
                        <AgentBreakControl
                          isOnBreak={isOnBreak}
                          startedAt={startedAt}
                          onBreakStart={() => breakStartMutation.mutate(agentSession.agentId)}
                          onBreakEnd={() => breakEndMutation.mutate(agentSession.agentId)}
                        />
                      );
                    })()}

                    {agentSummaries.filter(s => s.shifts.length > 0).map(({ agent, shifts: agentShifts, overtimeHours, releasedHours, baseHours }) => (
                      <ShiftLever
                        key={agent.id}
                        agent={agent}
                        shift={agentShifts[0]}
                        leverState={leverState[agentShifts[0]?.id]}
                        onLeverPreview={previewLeverChange}
                        onLeverCommit={(_id, start, end) => {
                          const shift = agentShifts[0];
                          if (!shift) return;
                          commitLeverChange(agent, shift, start, end);
                        }}
                        onBreakChange={(_id, breakStart) => {
                          const shift = agentShifts[0];
                          if (!shift) return;
                          commitBreakChange(agent, shift, breakStart);
                        }}
                        highlighted={highlighted === agent.id}
                        onHighlight={() => setHighlighted(agent.id)}
                        onUnhighlight={() => setHighlighted(null)}
                        baseHours={baseHours}
                        overtimeHours={overtimeHours}
                        releasedHours={releasedHours}
                        canEdit={canEditAgentLane(agent.id)}
                        utcHour={utcHour}
                        selectedDay={selectedDay}
                        playSoftClick={playSoftClick}
                        playDragWhoosh={playDragWhoosh}
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

                <div className="shrink-0 min-h-0" style={{ maxHeight: '12rem', overflow: 'hidden' }}>
                  <SummaryPanel
                    agentSummaries={agentSummaries}
                    selectedDay={selectedDay}
                    selectedDate={selectedDate}
                    zeroCoverageHours={zeroCoverageHours}
                    peakCoverageHour={peakCoverageHour}
                    totalOvertimeHours={totalOvertimeHours}
                    totalReleasedHours={totalReleasedHours}
                    canClaimCoverage={canClaimCoverage}
                    gapSlices={gapSlices}
                    onAssignGap={openGapAssignModal}
                    pendingClaims={pendingCoverageClaims}
                    agents={agents}
                    onOpenOvertime={openOvertimeForRecord}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assign Overtime Modal */}
      {assignModal && (
        <AssignOvertimeModal
          source={assignModal}
          agents={agents}
          onAssign={(toAgentId) => {
            if (assignModal.kind === "shift") {
              assignOvertimeMutation.mutate({
                fromShiftId: assignModal.shift.id,
                toAgentId,
                hours: assignModal.freedHours,
                date: assignModal.date,
                dayOfWeek: assignModal.dayOfWeek,
                coverStartUtc: assignModal.startUtc,
                coverEndUtc: assignModal.endUtc,
              });
              return;
            }

            assignOvertimeMutation.mutate({
              toAgentId,
              hours: assignModal.freedHours,
              date: assignModal.date,
              dayOfWeek: assignModal.dayOfWeek,
              coverStartUtc: assignModal.startUtc,
              coverEndUtc: assignModal.endUtc,
            });
          }}
          onClose={() => setAssignModal(null)}
        />
      )}
    </TooltipProvider>
  );
}

function EmptyState({
  isWeekend,
  dayLabel,
  canClaimCoverage,
  gapSlices,
  onAssignGap,
}: {
  isWeekend: boolean;
  dayLabel: string;
  canClaimCoverage: boolean;
  gapSlices: GapSlice[];
  onAssignGap: (startUtc: number, endUtc: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center max-w-xs">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Clock size={24} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">
          {isWeekend ? `${dayLabel} — Weekend` : `No shifts on ${dayLabel}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {isWeekend
            ? "No shifts are scheduled on weekends. Head to Agents to add weekend coverage."
            : "No agents have shifts scheduled for this day. Go to Agents to set up shifts."}
        </p>
      </div>
      {canClaimCoverage && gapSlices.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {gapSlices.slice(0, 8).map((gap) => (
            <button
              key={`${gap.startUtc}-${gap.endUtc}`}
              onClick={() => onAssignGap(gap.startUtc, gap.endUtc)}
              className="text-[10px] px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15 transition-colors"
            >
              {"Join line "}{formatUtcHour(gap.startUtc)}-{formatUtcHour(gap.endUtc)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UnifiedTimeline({
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
  const PX_PER_HOUR = 56;
  const LABEL_W     = 120;
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
        if (!isOvernight || scope === "day") return rowOffsetX;
        return seg.dayOffset === 0
          ? rowOffsetX - 24 * PX_PER_HOUR   // previous day column
          : rowOffsetX;                      // shift's own day column
      };

      const { pct, otPct } = scope === "day" && selectedDay === getUTCDay()
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
              {h}h
            </span>
          )}
        </div>
      );
    });
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
                    if (h % 2 !== 0) return null;
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

function ClockVisualizer({
  agents, shifts, isAdmin, agentSessionId, visible, highlighted, setHighlighted,
  leverState, utcHour, coverage, otRecords,
  tooltipInfo, setTooltipInfo, selectedDay, onAssignOvertime, onAssignGap, onOpenOvertime,
}: {
  agents: Agent[]; shifts: Shift[]; isAdmin: boolean; agentSessionId: number | null; visible: Set<number>;
  highlighted: number | null; setHighlighted: (id: number | null) => void;
  leverState: Record<number, LeverState>; utcHour: number;
  coverage: number[]; otRecords: OvertimeLog[];
  tooltipInfo: any; setTooltipInfo: (v: any) => void;
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

  const NON_HOVER_START = 9;
  const NON_HOVER_END   = 15;

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

        {Array.from({ length: 24 }, (_, h) => {
          const isMajor = h % 6 === 0;
          const labelR  = HEAT_R + (isMajor ? 18 : 14);
          const p = polarToCartesian(CX, CY, labelR, hourToAngle(h));
          return (
            <text key={`outer-${h}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={isMajor ? 7 : 5.5}
              fill={isMajor ? "rgba(255,215,0,0.95)" : "rgba(255,255,255,0.45)"}
              fontFamily="Space Mono, monospace"
              fontWeight={isMajor ? "700" : "500"}
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
          // strokeDasharray approximates per-hour dash segments along the arc circumference
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

function ShiftLever({
  agent, shift, leverState, onLeverPreview, onLeverCommit,
  onBreakChange,
  highlighted, onHighlight, onUnhighlight,
  baseHours, overtimeHours, releasedHours, canEdit, utcHour, selectedDay,
  playSoftClick, playDragWhoosh,
}: {
  agent: Agent; shift: Shift | undefined;
  leverState: LeverState | undefined;
  onLeverPreview: (id: number, start: number, end: number) => void;
  onLeverCommit: (id: number, start: number, end: number) => void;
  onBreakChange: (id: number, breakStart: number | null) => void;
  highlighted: boolean; onHighlight: () => void; onUnhighlight: () => void;
  baseHours: number; overtimeHours: number; releasedHours: number;
  canEdit: boolean; utcHour: number; selectedDay: number;
  playSoftClick: () => void;
  playDragWhoosh: () => void;
}) {
  if (!shift || !leverState) return null;

  const { startUtc, endUtc } = shift;
  const { activeStart, activeEnd } = leverState;
  const resolved = resolveShift(startUtc, endUtc, activeStart, activeEnd, shift.breakStart ?? null);

  const isToday = selectedDay === getUTCDay();
  const { pct, otPct } = isToday
    ? shiftProgress(startUtc, endUtc, activeStart, activeEnd, utcHour)
    : { pct: 0, otPct: 0 };

  const barMax    = 48;
  const normEnd   = normaliseEndUtc(startUtc, endUtc);
  const baseLeft  = (startUtc / barMax) * 100;
  const baseWidth = (resolved.baseDuration / barMax) * 100;
  const actLeft   = (activeStart / barMax) * 100;
  const actWidth  = (resolved.activeDuration / barMax) * 100;

  const commitWindow = (start: number, end: number) => {
    const next = clampShiftWindow(start, end);
    onLeverPreview(shift.id, next.activeStart, next.activeEnd);
    onLeverCommit(shift.id, next.activeStart, next.activeEnd);
  };

  const adjustEnd = (delta: number) => {
    if (!canEdit) return;
    commitWindow(activeStart, activeEnd + delta);
  };

  const adjustStart = (delta: number) => {
    if (!canEdit) return;
    commitWindow(activeStart + delta, activeEnd);
  };

  const setBreakAt = (nextBreak: number | null) => {
    if (!canEdit) return;
    if (nextBreak == null) {
      onBreakChange(shift.id, null);
      return;
    }
    const min = activeStart;
    const max = activeEnd - 0.5;
    if (max < min) return;
    const snapped = Math.round(nextBreak * 2) / 2;
    const clamped = Math.max(min, Math.min(max, snapped));
    onBreakChange(shift.id, clamped);
  };

  const moveBreakBy = (delta: number) => {
    if (!canEdit || shift.breakStart == null) return;
    setBreakAt(shift.breakStart + delta);
  };

  const setBreakDefault = () => {
    if (!canEdit) return;
    const duration = Math.max(0.5, activeEnd - activeStart);
    const centered = activeStart + Math.max(0, (duration - 0.5) / 2);
    setBreakAt(centered);
  };

  const barRef   = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    type: "start" | "end" | "move";
    startX: number;
    startVal: number;
    startEnd: number;
    currentStart: number;
    currentEnd: number;
  } | null>(null);

  const onMouseDown = (e: React.MouseEvent, type: "start" | "end" | "move") => {
    if (!canEdit) return;
    e.preventDefault();
    playDragWhoosh();
    dragging.current = {
      type,
      startX: e.clientX,
      startVal: activeStart,
      startEnd: activeEnd,
      currentStart: activeStart,
      currentEnd: activeEnd,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !barRef.current) return;
      const rect  = barRef.current.getBoundingClientRect();
      const delta = ((ev.clientX - dragging.current.startX) / rect.width) * barMax;
      const { type: t, startVal, startEnd } = dragging.current;
      if (t === "start") {
        const next = clampShiftWindow(startVal + delta, startEnd);
        dragging.current.currentStart = next.activeStart;
        dragging.current.currentEnd = next.activeEnd;
        onLeverPreview(shift.id, next.activeStart, next.activeEnd);
      } else if (t === "end") {
        const next = clampShiftWindow(startVal, startEnd + delta);
        dragging.current.currentStart = next.activeStart;
        dragging.current.currentEnd = next.activeEnd;
        onLeverPreview(shift.id, next.activeStart, next.activeEnd);
      } else {
        const dur = startEnd - startVal;
        const next = clampShiftWindow(startVal + delta, startVal + delta + dur);
        dragging.current.currentStart = next.activeStart;
        dragging.current.currentEnd = next.activeEnd;
        onLeverPreview(shift.id, next.activeStart, next.activeEnd);
      }
    };
    const onUp = () => { 
      if (dragging.current) {
        onLeverCommit(shift.id, dragging.current.currentStart, dragging.current.currentEnd);
      }
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
        {activeStart > startUtc && (
          <div className="absolute h-3 top-1 rounded-sm"
            style={{
              left: `${(startUtc / barMax) * 100}%`,
              width: `${((activeStart - startUtc) / barMax) * 100}%`,
              background: "repeating-linear-gradient(90deg,rgba(255,140,0,0.6) 0px,rgba(255,140,0,0.6) 3px,transparent 3px,transparent 6px)",
            }}
          />
        )}
        {activeEnd < normEnd && (
          <div className="absolute h-3 top-1 rounded-sm"
            style={{
              left: `${(activeEnd / barMax) * 100}%`,
              width: `${((normEnd - activeEnd) / barMax) * 100}%`,
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
            cursor: canEdit ? "grab" : "default",
          }}
          onMouseDown={e => onMouseDown(e, "move")}
        />
        {activeStart < startUtc && (
          <div className="absolute h-full rounded-sm"
            style={{
              left: `${(activeStart / barMax) * 100}%`,
              width: `${((startUtc - activeStart) / barMax) * 100}%`,
              backgroundColor: agent.color,
              boxShadow: `0 0 6px white, 0 0 10px ${agent.color}`,
            }}
          />
        )}
        {activeEnd > normEnd && (
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
        {canEdit && (
          <div className="absolute top-0 bottom-0 w-2 rounded-l-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `${actLeft}%` }}
            onMouseDown={e => onMouseDown(e, "start")}
          />
        )}
        {canEdit && (
          <div className="absolute top-0 bottom-0 w-2 rounded-r-sm hover:opacity-100 opacity-0 bg-white/30 cursor-col-resize z-10"
            style={{ left: `calc(${actLeft}% + ${Math.max(1, actWidth)}% - 8px)` }}
            onMouseDown={e => onMouseDown(e, "end")}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {canEdit && <button onClick={() => { playSoftClick(); adjustStart(-0.5); }} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier start">← 30m</button>}
          {canEdit && <button onClick={() => { playSoftClick(); adjustStart(0.5); }}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later start">30m →</button>}
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeStart)}</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{formatDuration(resolved.activeDuration)}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-muted-foreground mx-1">{formatUtcHour(activeEnd)}</span>
          {canEdit && <button onClick={() => { playSoftClick(); adjustEnd(-0.5); }} className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Earlier end">← 30m</button>}
          {canEdit && <button onClick={() => { playSoftClick(); adjustEnd(0.5); }}  className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors" title="Later end">30m →</button>}
        </div>
      </div>

      {canEdit && (
        <div className="mt-1.5 flex items-center gap-1 text-[9px]">
          {shift.breakStart == null ? (
            <button
              onClick={() => { playSoftClick(); setBreakDefault(); }}
              className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
              title="Set 30m break near center of current shift"
            >
              ☕ Set break
            </button>
          ) : (
            <>
              <button
                onClick={() => { playSoftClick(); moveBreakBy(-0.5); }}
                className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
                title="Move break earlier by 30m"
              >
                ☕ ←
              </button>
              <button
                onClick={() => { playSoftClick(); moveBreakBy(0.5); }}
                className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
                title="Move break later by 30m"
              >
                ☕ →
              </button>
              <button
                onClick={() => { playSoftClick(); setBreakAt(null); }}
                className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
                title="Clear break"
              >
                Clear break
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

function SummaryPanel({
  agentSummaries,
  selectedDay,
  selectedDate,
  zeroCoverageHours,
  peakCoverageHour,
  totalOvertimeHours,
  totalReleasedHours,
  canClaimCoverage,
  gapSlices,
  onAssignGap,
  pendingClaims,
  agents,
  onOpenOvertime,
}: any) {
  const agentMap = new Map<number, Agent>((agents ?? []).map((a: Agent) => [a.id, a]));
  const coveredByName = (id: number | null) => (id != null ? agentMap.get(id)?.name : null);

  return (
    <div className="border-t border-border p-3 max-h-52 min-h-0 overflow-y-auto overscroll-contain bg-card/30 shrink-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-medium">
        Coverage Report · {formatWeekdayWithDate(selectedDay, selectedDate)}
      </p>
      {zeroCoverageHours > 0 && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-[10px] text-red-400 font-medium">
            ⚠ {zeroCoverageHours} hour{zeroCoverageHours !== 1 ? "s" : ""} with zero coverage
          </p>
          {canClaimCoverage && gapSlices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {gapSlices.slice(0, 8).map((gap: GapSlice) => (
                <button
                  key={`${gap.startUtc}-${gap.endUtc}`}
                  onClick={() => onAssignGap(gap.startUtc, gap.endUtc)}
                  className="text-[10px] px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  {"Join line "}{formatUtcHour(gap.startUtc)}-{formatUtcHour(gap.endUtc)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingClaims.length > 0 && (
        <div className="mb-2 p-2 rounded border border-amber-500/30 bg-amber-500/10">
          <p className="text-[10px] text-amber-300 font-medium mb-1">
            {pendingClaims.length} claim{pendingClaims.length !== 1 ? "s" : ""} waiting manager approval
          </p>
          <div className="space-y-1">
            {pendingClaims.slice(0, 4).map((claim: OvertimeLog) => {
              const target = agentMap.get(claim.agentId)?.name ?? "Agent";
              const fromName = coveredByName(claim.coveredByAgentId);
              const context = claim.origin === "claimed-open-gap"
                ? `open gap ${formatUtcHour(claim.coverStartUtc!)}-${formatUtcHour(claim.coverEndUtc!)} UTC`
                : `${fromName ?? "agent"} → ${target} ${formatUtcHour(claim.coverStartUtc!)}-${formatUtcHour(claim.coverEndUtc!)} UTC`;

              return (
                <button
                  key={claim.id}
                  onClick={() => onOpenOvertime(claim)}
                  className="w-full flex items-center justify-between text-left text-[10px] text-amber-100 hover:text-primary transition-colors"
                  title="Open overtime log"
                >
                  <span>{target} waiting approval from manager · {context}</span>
                  <ExternalLink size={10} className="opacity-60 shrink-0" />
                </button>
              );
            })}
          </div>
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

/* ──────────────────────────────────────────────────────────────
   Assign Overtime Modal
   ────────────────────────────────────────────────────────────── */

function AssignOvertimeModal({
  source, agents, onAssign, onClose,
}: {
  source:
    | {
        kind: "shift";
        shift: Shift;
        fromAgent: Agent;
        dayOfWeek: number;
        date: string;
        startUtc: number;
        endUtc: number;
        freedHours: number;
      }
    | {
        kind: "gap";
        dayOfWeek: number;
        date: string;
        startUtc: number;
        endUtc: number;
        freedHours: number;
      };
  agents: Agent[];
  onAssign: (toAgentId: number) => void;
  onClose: () => void;
}) {
  const otherAgents = source.kind === "shift"
    ? agents.filter(a => a.id !== source.fromAgent.id)
    : agents;
  const sourceLabel = source.kind === "shift"
    ? `${formatDuration(source.freedHours)} freed from ${source.fromAgent.name}'s ${formatWeekdayWithDate(source.dayOfWeek, source.date)} shift`
    : `${formatDuration(source.freedHours)} open gap on ${formatWeekdayWithDate(source.dayOfWeek, source.date)} · ${formatUtcHour(source.startUtc)}-${formatUtcHour(source.endUtc)} UTC`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-sm font-semibold">Assign Overtime</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {source.kind === "shift" ? (
                <>
                  {formatDuration(source.freedHours)} freed from{" "}
                  <span style={{ color: source.fromAgent.color }}>{source.fromAgent.name}</span>'s {formatWeekdayWithDate(source.dayOfWeek, source.date)} shift
                </>
              ) : (
                sourceLabel
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* Agent list */}
        <div className="p-2 max-h-64 overflow-y-auto">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1.5">
            Select an agent to receive this overtime
          </p>
          {otherAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onAssign(agent.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/70 transition-all group text-left"
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{agent.name}</span>
                <span className="text-[10px] text-muted-foreground ml-2">{agent.role}</span>
              </div>
              <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors">
                +{formatDuration(source.freedHours)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
