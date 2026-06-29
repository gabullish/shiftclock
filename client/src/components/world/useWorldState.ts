import { useQuery } from "@tanstack/react-query";
import type { Agent, Shift, Absence } from "@shared/schema";
import type { RoomId } from "./rooms.config";
import { getAgentOffDays, activeAbsence } from "@/lib/dashboardUtils";
import { normaliseEndUtc } from "@/lib/shiftUtils";

export interface AgentWorldData {
  agent: Agent;
  state: RoomId;
}

function isOnShift(agent: Agent, shifts: Shift[]): boolean {
  const nowUtc = new Date();
  const dow = nowUtc.getUTCDay();
  const utcHour = nowUtc.getUTCHours() + nowUtc.getUTCMinutes() / 60;

  // The previous UTC day (and the date it fell on) — needed so an overnight
  // shift that started yesterday and runs past midnight still counts as "on
  // shift" during its post-midnight tail. Each day's off-cycle is evaluated
  // against that day's own date, not always today's.
  const prevDow = (dow + 6) % 7;
  const prevDate = new Date(nowUtc);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);

  const todayOff = getAgentOffDays(agent, nowUtc).includes(dow);
  const prevOff = getAgentOffDays(agent, prevDate).includes(prevDow);

  const agentShifts = shifts.filter(s => s.agentId === agent.id);
  for (const shift of agentShifts) {
    const start = shift.activeStart ?? shift.startUtc;
    const end = normaliseEndUtc(start, shift.activeEnd ?? shift.endUtc);

    // Same-day portion: [start, min(end, 24)). For a 0–24 shift this is the
    // whole window; for an overnight shift it's only the pre-midnight part.
    if (shift.dayOfWeek === dow && !todayOff) {
      if (utcHour >= start && utcHour < Math.min(end, 24)) return true;
    }

    // Post-midnight tail of yesterday's overnight shift: [0, end - 24).
    if (shift.dayOfWeek === prevDow && !prevOff && end > 24) {
      if (utcHour < end - 24) return true;
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
