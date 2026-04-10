// Main dashboard page — orchestrates data fetching, day selection, lever state,
// and hands slices to the clock/timeline/panel components.
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift, OvertimeLog } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RotateCcw, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { useSoothingSounds } from "@/hooks/use-soothing-sounds";
import { toast } from "@/hooks/use-toast";
import { useAgentSession } from "@/hooks/use-agent-session";
import {
  clampShiftWindow,
  resolveShift,
  calcCoverageForDay,
  formatUtcHour,
  formatDuration,
  normaliseEndUtc,
  getActiveClaimForShift,
  isCoverageClaim,
} from "@/lib/shiftUtils";
import {
  getUTCDay, getUTCHour,
  parseIsoDate, resolveDateForWeekday,
  formatWeekdayWithDate, buildWeekCycleDays,
  findGapRanges, expandGapRangesToSlices,
  errorMessageFromUnknown,
  type LeverState, type TooltipInfo,
} from "@/lib/dashboardUtils";
import { KpiCell }             from "@/components/dashboard/KpiCell";
import { AgentBreakControl }   from "@/components/dashboard/AgentBreakControl";
import { EmptyState }          from "@/components/dashboard/EmptyState";
import { SummaryPanel }        from "@/components/dashboard/SummaryPanel";
import { AssignOvertimeModal } from "@/components/dashboard/AssignOvertimeModal";
import { ShiftLever }          from "@/components/dashboard/ShiftLever";
import { ClockVisualizer }     from "@/components/dashboard/ClockVisualizer";
import { UnifiedTimeline }     from "@/components/dashboard/UnifiedTimeline";

// Stable empty arrays — module-level so these are the same reference across renders.
// Avoids spurious effect re-runs from the `= []` inline default in useQuery destructuring.
const NO_AGENTS:  Agent[]       = [];
const NO_SHIFTS:  Shift[]       = [];
const NO_OT:      OvertimeLog[] = [];

export default function Dashboard() {
  const isAdmin = useAdminMode();
  const agentSession = useAgentSession();
  const { playSoftClick, playDragWhoosh, playSuccess, playBreakStart } = useSoothingSounds();

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
  const [tooltipInfo,    setTooltipInfo]    = useState<TooltipInfo | null>(null);

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

  const { data: agents    = NO_AGENTS } = useQuery<Agent[]>({ queryKey: ["/api/agents"], refetchInterval: 30_000, staleTime: Infinity });
  const { data: allShifts = NO_SHIFTS } = useQuery<Shift[]>({ queryKey: ["/api/shifts"], refetchInterval: 15_000, staleTime: Infinity });
  const { data: otRecords = NO_OT     } = useQuery<OvertimeLog[]>({ queryKey: ["/api/overtime"], refetchInterval: 15_000, staleTime: Infinity });

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

  const visibleInitialized = useRef(false);
  useEffect(() => {
    if (!visibleInitialized.current && agents.length > 0) {
      visibleInitialized.current = true;
      setVisible(new Set(agents.map(a => a.id)));
    }
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
        const clamped = clampShiftWindow(s.activeStart ?? s.startUtc, s.activeEnd ?? normEnd);
        next[s.id] = { activeStart: clamped.activeStart, activeEnd: clamped.activeEnd };
      }
    }
    setLeverState(prev => {
      // Bail out if nothing actually changed — avoids spurious re-renders
      const changed = Object.entries(next).some(([id, val]) => {
        const p = prev[Number(id)];
        return !p || p.activeStart !== val.activeStart || p.activeEnd !== val.activeEnd;
      });
      return changed ? { ...prev, ...next } : prev;
    });
  }, [allShifts]);

  const updateSelectedDay = (
    dayOfWeek: number,
    date = resolveDateForWeekday(dayOfWeek, selectedDate ? parseIsoDate(selectedDate) : new Date())
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
  const coverage = calcCoverageForDay(coverageInput);

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
    let coveredOutHours = 0;
    let coveredByAgentId: number | null = null;
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

      // Track outgoing coverage claims separately — do NOT add to releasedHours
      // (shrinkHours already accounts for the freed hours; claiming just marks them covered)
      const outgoingClaim = getActiveClaimForShift(s, otRecords, selectedDay);
      if (outgoingClaim && outgoingClaim.coverStartUtc != null && outgoingClaim.coverEndUtc != null) {
        const claimedHrs = outgoingClaim.coverEndUtc - outgoingClaim.coverStartUtc;
        coveredOutHours += claimedHrs;
        if (outgoingClaim.status === "approved" || outgoingClaim.status === "paid") {
          coveredByAgentId = outgoingClaim.agentId;
        }
      }
    }
    for (const claim of approvedClaims) {
      const claimHours = claim.coverEndUtc! - claim.coverStartUtc!;
      activeHours += claimHours;
      overtimeHours += claimHours;
    }
    return { agent, baseHours, activeHours, overtimeHours, releasedHours, coveredOutHours, coveredByAgentId, shifts: agentTodayShifts };
  });

  const zeroCoverageHours  = coverage.filter(c => c === 0).length;
  const gapRanges          = findGapRanges(coverage);
  const gapSlices          = expandGapRangesToSlices(gapRanges);
  const peakCoverageHour   = coverage.indexOf(Math.max(...coverage));
  const totalOvertimeHours = agentSummaries.reduce((a, s) => a + s.overtimeHours, 0);
  // Only count hours that haven't been claimed yet as "up for grabs"
  const totalReleasedHours = agentSummaries.reduce((a, s) => a + Math.max(0, s.releasedHours - s.coveredOutHours), 0);
  const pendingCoverageClaims = otRecords.filter(
    (record) =>
      isCoverageClaim(record) &&
      record.status === "pending" &&
      record.dayOfWeek === selectedDay &&
      record.coverStartUtc != null &&
      record.coverEndUtc != null
  );

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

  // Agents whose break is within the next 30 min (but not yet started)
  const agentsBreakSoon = isSelectedDateToday ? onlineAgents.filter(agent => {
    if (agent.breakActiveAt) return false;
    return todayShifts.some(s =>
      s.agentId === agent.id &&
      s.breakStart != null &&
      utcHour >= s.breakStart - 0.5 &&
      utcHour < s.breakStart + 0.5
    );
  }) : [];

  const hasShiftsToday = todayShifts.length > 0;
  const isWeekend      = selectedDay === 0 || selectedDay === 6;

  const handleUndoDay = () => {
    if (!window.confirm("Reset levers and pending OT for this day?")) return;

    // Optimistically reset lever state for visual immediacy
    const reset: Record<number, LeverState> = { ...leverState };
    for (const s of todayShifts) {
      const normEnd = normaliseEndUtc(s.startUtc, s.endUtc);
      reset[s.id] = { activeStart: s.startUtc, activeEnd: normEnd };
    }
    setLeverState(reset);

    // Warn if approved/paid OT records exist for this date — they won't be cleared
    const approvedOnDay = otRecords.filter(
      r => r.date === selectedDate && (r.status === "approved" || r.status === "paid")
    );
    if (approvedOnDay.length > 0) {
      toast({
        title: `Heads up: ${approvedOnDay.length} approved OT record${approvedOnDay.length > 1 ? "s" : ""} will remain`,
        description: "Reset clears lever positions and pending OT only. Approved/paid records stay.",
      });
    }

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
    const claimDayOfWeek = dayOff !== 0 ? ((shift.dayOfWeek + dayOff + 7) % 7) : shift.dayOfWeek;
    const claimDate = dayOff !== 0 ? (() => {
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
      actionType: nextBreak == null ? "break-removed" : "break-scheduled",
      description: nextBreak == null
        ? `${agent.name} removed their break on ${formatWeekdayWithDate(selectedDay, selectedDate)}.`
        : `${agent.name} scheduled their break for ${formatUtcHour(nextBreak)} on ${formatWeekdayWithDate(selectedDay, selectedDate)}.`,
    });
  };

  // bulkDeleteOTMutation — wired up for future bulk OT delete action; keep the hook alive
  void bulkDeleteOTMutation;

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
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium shrink-0">Online now</span>
            {onlineAgents.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No agents currently on shift</span>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {onlineAgents.map(agent => {
                  const agentOnBreak = Boolean(agent.breakActiveAt);
                  const breakElapsed = agentOnBreak && agent.breakActiveAt
                    ? Math.floor((Date.now() - Date.parse(agent.breakActiveAt)) / 60000)
                    : null;
                  return (
                    <div key={agent.id}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-300",
                        agentOnBreak && "ring-1 ring-amber-400/60 shadow-[0_0_10px_rgba(251,191,36,0.25)]"
                      )}
                      style={{
                        backgroundColor: agentOnBreak ? "rgba(251,191,36,0.12)" : agent.color + "20",
                        border: `1px solid ${agentOnBreak ? "rgba(251,191,36,0.4)" : agent.color + "40"}`,
                        color: agentOnBreak ? "rgb(252,211,77)" : agent.color,
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: agentOnBreak ? "rgb(251,191,36)" : agent.color }} />
                      {agent.name}
                      {agentOnBreak && breakElapsed !== null && (
                        <span className="opacity-80">☕ {breakElapsed}m</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Break-soon callout — right side of the strip */}
            {agentsBreakSoon.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                <span className="text-[10px] text-amber-400/70 uppercase tracking-wider font-medium">Break soon</span>
                {agentsBreakSoon.map(agent => {
                  const bShift = todayShifts.find(s => s.agentId === agent.id && s.breakStart != null);
                  const minsUntil = bShift?.breakStart != null
                    ? Math.max(0, Math.round((bShift.breakStart - utcHour) * 60))
                    : null;
                  return (
                    <div key={agent.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 border border-amber-500/25 text-amber-400 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agent.color }} />
                      {agent.name}
                      {minsUntil !== null && <span className="opacity-70">in {minsUntil}m</span>}
                    </div>
                  );
                })}
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
              <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 overflow-hidden min-w-0 relative min-h-[220px] md:min-h-0">
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
                  <div className="flex flex-wrap gap-1.5 justify-center mt-3 max-w-2xl" style={{ pointerEvents: "none" }}>
                    <button onClick={toggleAll}
                      className="text-xs px-2.5 py-1 min-h-[30px] rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all flex items-center"
                      style={{ pointerEvents: "auto" }}>
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
                            "text-xs px-2.5 py-1.5 min-h-[30px] flex items-center rounded-full border font-medium transition-all duration-150",
                            visible.has(agent.id)
                              ? isOnBreak
                                ? "ring-1 ring-amber-400/70 animate-pulse"
                                : "opacity-100"
                              : "opacity-40 grayscale"
                          )}
                          style={{
                            pointerEvents: "auto",
                            borderColor: isOnBreak ? "rgba(251,191,36,0.5)" : agent.color + "60",
                            backgroundColor: visible.has(agent.id) ? agent.color + "20" : "transparent",
                            color: isOnBreak ? "rgb(252,211,77)" : visible.has(agent.id) ? agent.color : "hsl(var(--muted-foreground))",
                            boxShadow: isOnBreak
                              ? "0 0 14px rgba(251,191,36,0.35)"
                              : highlighted === agent.id ? `0 0 8px ${agent.color}50` : undefined,
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
              <div className="w-full md:w-64 lg:w-72 xl:w-80 flex flex-col border-t md:border-t-0 md:border-l border-border overflow-y-auto shrink-0 md:min-h-0 max-h-[42vh] md:max-h-none">
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
                          className="text-[10px] flex items-center gap-1 transition-colors select-none text-muted-foreground hover:text-foreground"
                          title="Reset levers and pending OT for this day"
                        >
                          <RotateCcw size={10} />
                          Reset day
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
          agents={agents.filter(a => {
            // Never show the source agent for shift-kind modals
            if (assignModal.kind === "shift" && a.id === assignModal.fromAgent.id) return false;
            // Only show agents who are scheduled on the same day of week
            return allShifts.some(s => s.agentId === a.id && s.dayOfWeek === assignModal.dayOfWeek);
          })}
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
