import { useQuery } from "@tanstack/react-query";
import type { Agent, Shift } from "@shared/schema";
import type { RoomId } from "./rooms.config";

export interface AgentWorldData {
  agent: Agent;
  state: RoomId;
}

function isOnShift(agent: Agent, shifts: Shift[]): boolean {
  const nowUtc = new Date();
  const dayOfWeek = nowUtc.getUTCDay();
  const utcHour = nowUtc.getUTCHours() + nowUtc.getUTCMinutes() / 60;

  const offDays = agent.offWeekend === 1 ? [0, 6] : [4, 5];
  if (offDays.includes(dayOfWeek)) return false;

  const todayShifts = shifts.filter(s => s.agentId === agent.id && s.dayOfWeek === dayOfWeek);
  for (const shift of todayShifts) {
    const start = shift.activeStart ?? shift.startUtc;
    const end = shift.activeEnd ?? shift.endUtc;
    if (end > 24) {
      if (utcHour >= start || utcHour < end - 24) return true;
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
  const { data: logs = [] } = useQuery<any[]>({
    queryKey: ["/api/agent-logs"],
    refetchInterval: 10_000,
  });

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
