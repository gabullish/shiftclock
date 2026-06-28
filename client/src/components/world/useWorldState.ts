import { useQuery } from "@tanstack/react-query";
import type { Agent, Shift } from "@shared/schema";
import type { RoomId } from "./rooms.config";
import { getAgentOffDays } from "@/lib/dashboardUtils";
import { getQueryFn } from "@/lib/queryClient";

export interface AgentWorldData {
  agent: Agent;
  state: RoomId;
}

function isOnShift(agent: Agent, shifts: Shift[]): boolean {
  const nowUtc = new Date();
  const dayOfWeek = nowUtc.getUTCDay();
  const utcHour = nowUtc.getUTCHours() + nowUtc.getUTCMinutes() / 60;

  const offDays = getAgentOffDays(agent, nowUtc);
  if (offDays.includes(dayOfWeek)) return false;

  const todayShifts = shifts.filter(s => s.agentId === agent.id && s.dayOfWeek === dayOfWeek);
  for (const shift of todayShifts) {
    const start = shift.activeStart ?? shift.startUtc;
    const end   = shift.activeEnd   ?? shift.endUtc;
    // Shift is overnight if either end > 24 (normalized as 25, 26, ...)
    // OR end < start (normalized 0-24 form, e.g. start=22, end=6).
    const wraps = end > 24 || end < start;
    if (wraps) {
      const wrapEnd = end > 24 ? end - 24 : end;
      if (utcHour >= start || utcHour < wrapEnd) return true;
    } else {
      if (utcHour >= start && utcHour < end) return true;
    }
  }
  return false;
}

export function useWorldState(): AgentWorldData[] {
  // Tight polling for real-time office visualization:
  //   agents: 5 s  — catches break start/end almost immediately
  //   shifts: 15 s — shift boundaries change at most once a day
  //   logs:   10 s — sick/vacation logs added infrequently but need to propagate quickly
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 5_000,
  });
  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
    refetchInterval: 15_000,
  });
  // /api/agent-logs requires an agent or admin session. The world view is also
  // reachable in view-only mode, so use on401:"returnNull" to degrade gracefully
  // (no sick/vacation room states for view-only) instead of throwing and breaking
  // the whole page.
  const { data: logsData } = useQuery<any[] | null>({
    queryKey: ["/api/agent-logs"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 10_000,
  });
  const logs = logsData ?? [];

  const today = new Date().toISOString().split("T")[0];

  return agents.map(agent => {
    if (agent.breakActiveAt) return { agent, state: "breakroom" };

    const todayLogs = logs.filter((l: any) => l.agentId === agent.id && l.date === today);
    if (todayLogs.some((l: any) => l.type === "sick")) return { agent, state: "clinic" };
    if (todayLogs.some((l: any) => l.type === "vacation")) return { agent, state: "beach" };

    if (isOnShift(agent, shifts)) return { agent, state: "office" };

    return { agent, state: "bedroom" };
  });
}
