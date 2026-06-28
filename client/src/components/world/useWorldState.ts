import { useQuery } from "@tanstack/react-query";
import type { Agent, Shift, Absence } from "@shared/schema";
import type { RoomId } from "./rooms.config";
import { getAgentOffDays, activeAbsence } from "@/lib/dashboardUtils";

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
  //   agents:    5 s — catches break start/end almost immediately
  //   shifts:   15 s — shift boundaries change at most once a day
  //   absences: 30 s — sick/vacation spans change infrequently
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 5_000,
  });
  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
    refetchInterval: 15_000,
  });
  const { data: absences = [] } = useQuery<Absence[]>({
    queryKey: ["/api/absences"],
    refetchInterval: 30_000,
  });

  const today = new Date().toISOString().split("T")[0];

  return agents.map(agent => {
    // Live break wins (someone actively on break right now).
    if (agent.breakActiveAt) return { agent, state: "breakroom" };

    // Sick / vacation come from absence spans covering today.
    const absence = activeAbsence(absences, agent.id, today);
    if (absence?.type === "sick") return { agent, state: "clinic" };
    if (absence?.type === "vacation") return { agent, state: "beach" };

    if (isOnShift(agent, shifts)) return { agent, state: "office" };

    return { agent, state: "bedroom" };
  });
}
