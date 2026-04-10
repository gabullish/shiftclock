import { db } from "./db";
import { agents, shifts, overtimeLog, agentLogs, overtimeClaims } from "@shared/schema";
import type { Agent, InsertAgent, Shift, InsertShift, OvertimeLog, InsertOvertimeLog, AgentLog, InsertAgentLog, OvertimeClaim, InsertOvertimeClaim } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export interface IStorage {
  // Agents
  getAgents(): Agent[];
  getAgent(id: number): Agent | undefined;
  createAgent(data: InsertAgent): Agent;
  updateAgent(id: number, data: Partial<InsertAgent>): Agent | undefined;
  deleteAgent(id: number): void;

  // Shifts
  getShifts(): Shift[];
  getShiftsByAgent(agentId: number): Shift[];
  upsertShift(data: InsertShift): Shift;
  updateShift(id: number, data: Partial<InsertShift>): Shift | undefined;
  deleteShift(id: number): void;

  // Weekly template apply
  applyWeekTemplate(agentId: number, startUtc: number, endUtc: number, offWeekend: number): Shift[];

  // Overtime
  getOvertimeLogs(): OvertimeLog[];
  getOvertimeByAgent(agentId: number): OvertimeLog[];
  createOvertimeLog(agentId: number, date: string, data: Partial<InsertOvertimeLog>): OvertimeLog;
  updateOvertimeLog(id: number, data: Partial<InsertOvertimeLog>): OvertimeLog | undefined;
  deleteOvertimeLog(id: number): void;
  bulkDeleteOvertimeLogs(ids: number[]): void;
  clearAllOvertimeLogs(): void;
  replaceOvertimeLogs(data: Array<Omit<OvertimeLog, "id">>): void;

  // Agent logs
  getAgentLogs(): AgentLog[];
  getAgentLogsByAgent(agentId: number): AgentLog[];
  createAgentLog(data: InsertAgentLog): AgentLog;
  upsertRecentAgentLog(data: InsertAgentLog, dedupeWindowMs?: number): AgentLog;
  deleteAgentLog(id: number): void;
  clearAllAgentLogs(): void;

  // Overtime claims (multi-agent competing for same opportunity)
  getClaimsForOpportunity(opportunityId: number): OvertimeClaim[];
  getClaimsByAgent(agentId: number): OvertimeClaim[];
  createClaim(data: Omit<InsertOvertimeClaim, "claimOrder">): OvertimeClaim;
  updateClaim(id: number, data: Partial<InsertOvertimeClaim>): OvertimeClaim | undefined;
  cancelClaim(id: number, agentId: number): OvertimeClaim | undefined;
  approveClaimAndRejectOthers(claimId: number, opportunityId: number): OvertimeClaim | undefined;
  deleteClaimsByOpportunity(opportunityId: number): void;

  // Live break state
  startLiveBreak(agentId: number): Agent | undefined;
  endLiveBreak(agentId: number): Agent | undefined;

  // Backup / restore
  exportAll(): { agents: Agent[]; shifts: Shift[]; overtime: OvertimeLog[]; logs: AgentLog[] };
  importAll(data: {
    agents: Array<Omit<Agent, "id"> & {
      shifts: Array<Omit<Shift, "id" | "agentId">>;
      historicalShifts?: Array<{ date: string; offWeekend: number; note?: string | null }>;
    }>;
    overtime?: Array<Omit<OvertimeLog, "id">>;
    logs?: Array<Omit<AgentLog, "id">>;
  }): void;
}

export const storage: IStorage = {
  getAgents() {
    return db.select().from(agents).all();
  },
  getAgent(id) {
    return db.select().from(agents).where(eq(agents.id, id)).get();
  },
  createAgent(data) {
    return db.insert(agents).values(data).returning().get();
  },
  updateAgent(id, data) {
    return db.update(agents).set(data).where(eq(agents.id, id)).returning().get();
  },
  deleteAgent(id) {
    // Cascade: remove all related data before deleting the agent
    db.delete(shifts).where(eq(shifts.agentId, id)).run();
    db.delete(overtimeLog).where(eq(overtimeLog.agentId, id)).run();
    db.delete(agentLogs).where(eq(agentLogs.agentId, id)).run();
    db.delete(agents).where(eq(agents.id, id)).run();
  },

  getShifts() {
    return db.select().from(shifts).all();
  },
  getShiftsByAgent(agentId) {
    return db.select().from(shifts).where(eq(shifts.agentId, agentId)).all();
  },
  upsertShift(data) {
    const existing = db.select().from(shifts)
      .where(and(eq(shifts.agentId, data.agentId), eq(shifts.dayOfWeek, data.dayOfWeek)))
      .get();
    if (existing) {
      return db.update(shifts).set(data).where(eq(shifts.id, existing.id)).returning().get()!;
    }
    return db.insert(shifts).values(data).returning().get();
  },
  updateShift(id, data) {
    return db.update(shifts).set(data).where(eq(shifts.id, id)).returning().get();
  },
  deleteShift(id) {
    db.delete(shifts).where(eq(shifts.id, id)).run();
  },

  applyWeekTemplate(agentId, startUtc, endUtc, offWeekend) {
    const offDays = offWeekend === 1 ? [0, 6] : [4, 5];
    const workDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !offDays.includes(d));

    for (const day of offDays) {
      const existing = db.select().from(shifts)
        .where(and(eq(shifts.agentId, agentId), eq(shifts.dayOfWeek, day)))
        .get();
      if (existing) {
        db.delete(shifts).where(eq(shifts.id, existing.id)).run();
      }
    }

    const result: Shift[] = [];
    for (const day of workDays) {
      const existing = db.select().from(shifts)
        .where(and(eq(shifts.agentId, agentId), eq(shifts.dayOfWeek, day)))
        .get();
      if (existing) {
        const updated = db.update(shifts)
          .set({ startUtc, endUtc, activeStart: null, activeEnd: null })
          .where(eq(shifts.id, existing.id))
          .returning().get()!;
        result.push(updated);
      } else {
        const created = db.insert(shifts)
          .values({ agentId, dayOfWeek: day, startUtc, endUtc, activeStart: null, activeEnd: null, breakStart: null })
          .returning().get();
        result.push(created);
      }
    }
    return result;
  },

  getOvertimeLogs() {
    return db.select().from(overtimeLog).all();
  },
  getOvertimeByAgent(agentId) {
    return db.select().from(overtimeLog).where(eq(overtimeLog.agentId, agentId)).all();
  },
  createOvertimeLog(agentId, date, data) {
    return db.insert(overtimeLog).values({ agentId, date, overtimeHours: 0, releasedHours: 0, ...data }).returning().get();
  },
  updateOvertimeLog(id, data) {
    return db.update(overtimeLog).set(data).where(eq(overtimeLog.id, id)).returning().get();
  },
  deleteOvertimeLog(id) {
    db.delete(overtimeLog).where(eq(overtimeLog.id, id)).run();
  },
  bulkDeleteOvertimeLogs(ids) {
    if (ids.length === 0) return;
    db.delete(overtimeLog).where(inArray(overtimeLog.id, ids)).run();
  },
  clearAllOvertimeLogs() {
    db.delete(overtimeLog).run();
  },
  replaceOvertimeLogs(data) {
    db.delete(overtimeLog).run();
    for (const record of data) {
      db.insert(overtimeLog).values(record).run();
    }
  },

  getAgentLogs() {
    return db.select().from(agentLogs).all();
  },
  getAgentLogsByAgent(agentId) {
    return db.select().from(agentLogs).where(eq(agentLogs.agentId, agentId)).all();
  },
  createAgentLog(data) {
    return db.insert(agentLogs).values(data).returning().get();
  },
  upsertRecentAgentLog(data, dedupeWindowMs = 5 * 60 * 1000) {
    // If a log with the same agentId + actionType + date exists within the window, update it instead
    if (data.actionType && data.date) {
      const recent = db.select().from(agentLogs)
        .where(and(
          eq(agentLogs.agentId, data.agentId),
          eq(agentLogs.actionType, data.actionType),
          eq(agentLogs.date, data.date),
        ))
        .all()
        .filter(l => {
          const age = Date.now() - new Date(l.createdAt).getTime();
          return age < dedupeWindowMs;
        });
      if (recent.length > 0) {
        const latest = recent[recent.length - 1];
        return db.update(agentLogs)
          .set({ description: data.description, createdAt: new Date().toISOString() })
          .where(eq(agentLogs.id, latest.id))
          .returning().get()!;
      }
    }
    return db.insert(agentLogs).values(data).returning().get();
  },
  deleteAgentLog(id) {
    db.delete(agentLogs).where(eq(agentLogs.id, id)).run();
  },
  clearAllAgentLogs() {
    db.delete(agentLogs).run();
  },

  // --- Overtime claims ---
  getClaimsForOpportunity(opportunityId) {
    return db.select().from(overtimeClaims)
      .where(eq(overtimeClaims.opportunityId, opportunityId))
      .all()
      .sort((a, b) => a.claimOrder - b.claimOrder);
  },
  getClaimsByAgent(agentId) {
    return db.select().from(overtimeClaims)
      .where(eq(overtimeClaims.agentId, agentId))
      .all();
  },
  createClaim(data) {
    // Determine next order for this opportunity
    const existing = db.select().from(overtimeClaims)
      .where(eq(overtimeClaims.opportunityId, data.opportunityId))
      .all();
    const nextOrder = existing.length + 1;
    return db.insert(overtimeClaims)
      .values({ ...data, claimOrder: nextOrder })
      .returning().get();
  },
  updateClaim(id, data) {
    return db.update(overtimeClaims).set(data).where(eq(overtimeClaims.id, id)).returning().get();
  },
  cancelClaim(id, agentId) {
    const claim = db.select().from(overtimeClaims)
      .where(and(eq(overtimeClaims.id, id), eq(overtimeClaims.agentId, agentId)))
      .get();
    if (!claim) return undefined;
    return db.update(overtimeClaims)
      .set({ status: "cancelled" })
      .where(eq(overtimeClaims.id, id))
      .returning().get();
  },
  approveClaimAndRejectOthers(claimId, opportunityId) {
    const approved = db.update(overtimeClaims)
      .set({ status: "approved" })
      .where(eq(overtimeClaims.id, claimId))
      .returning().get();
    // Reject all other pending claims for same opportunity
    const others = db.select().from(overtimeClaims)
      .where(and(eq(overtimeClaims.opportunityId, opportunityId), eq(overtimeClaims.status, "pending")))
      .all();
    for (const other of others) {
      if (other.id !== claimId) {
        db.update(overtimeClaims).set({ status: "rejected" }).where(eq(overtimeClaims.id, other.id)).run();
      }
    }
    return approved;
  },
  deleteClaimsByOpportunity(opportunityId) {
    db.delete(overtimeClaims).where(eq(overtimeClaims.opportunityId, opportunityId)).run();
  },

  startLiveBreak(agentId) {
    return db.update(agents).set({ breakActiveAt: new Date().toISOString() })
      .where(eq(agents.id, agentId)).returning().get();
  },
  endLiveBreak(agentId) {
    return db.update(agents).set({ breakActiveAt: null })
      .where(eq(agents.id, agentId)).returning().get();
  },

  exportAll() {
    return {
      agents: db.select().from(agents).all(),
      shifts: db.select().from(shifts).all(),
      overtime: db.select().from(overtimeLog).all(),
      logs: db.select().from(agentLogs).all(),
    };
  },

  importAll(data) {
    const currentAgents = db.select().from(agents).all();
    for (const a of currentAgents) {
      db.delete(shifts).where(eq(shifts.agentId, a.id)).run();
      db.delete(overtimeLog).where(eq(overtimeLog.agentId, a.id)).run();
      db.delete(agentLogs).where(eq(agentLogs.agentId, a.id)).run();
      db.delete(agents).where(eq(agents.id, a.id)).run();
    }

    const oldToNewAgentId = new Map<number, number>();
    const agentNameToId = new Map<string, number>();

    for (const agentData of data.agents) {
      const { shifts: agentShifts, historicalShifts, id: oldAgentId, ...agentFields } = agentData as any;
      const newAgent = db.insert(agents).values(agentFields).returning().get();
      if (typeof oldAgentId === "number") {
        oldToNewAgentId.set(oldAgentId, newAgent.id);
      }
      agentNameToId.set((agentFields as any).name, newAgent.id);

      for (const s of (agentShifts ?? [])) {
        db.insert(shifts)
          .values({ ...s, agentId: newAgent.id, activeStart: null, activeEnd: null })
          .run();
      }

      // Convert historical shifts to agent logs
      if (Array.isArray(historicalShifts)) {
        for (const hs of historicalShifts) {
          db.insert(agentLogs).values({
            agentId: newAgent.id,
            date: hs.date,
            type: "schedule_change",
            description: `Imported retroactive shift: ${hs.note || "Weekly pattern"}`,
            notes: hs.note || null,
            actionType: "admin_import",
            createdAt: new Date().toISOString(),
          }).run();
        }
      }
    }

    if (Array.isArray(data.overtime)) {
      for (const row of data.overtime) {
        const mappedAgentId = oldToNewAgentId.get(row.agentId);
        if (!mappedAgentId) continue;
        const mappedCoveredById = row.coveredByAgentId == null
          ? null
          : (oldToNewAgentId.get(row.coveredByAgentId) ?? null);

        db.insert(overtimeLog).values({
          ...row,
          agentId: mappedAgentId,
          coveredByAgentId: mappedCoveredById,
          fromShiftId: null,
        }).run();
      }
    }

    if (Array.isArray(data.logs)) {
      for (const row of data.logs) {
        const mappedAgentId = oldToNewAgentId.get(row.agentId);
        if (!mappedAgentId) continue;
        const mappedCoveredById = row.coveredByAgentId == null
          ? null
          : (oldToNewAgentId.get(row.coveredByAgentId) ?? null);

        db.insert(agentLogs).values({
          ...row,
          agentId: mappedAgentId,
          coveredByAgentId: mappedCoveredById,
        }).run();
      }
    }
  },
};
