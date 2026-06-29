import { db } from "./db";
import { agents, shifts, overtimeLog, agentLogs, overtimeClaims, absences } from "@shared/schema";
import type { Agent, InsertAgent, Shift, InsertShift, OvertimeLog, InsertOvertimeLog, AgentLog, InsertAgentLog, OvertimeClaim, InsertOvertimeClaim, Absence, InsertAbsence } from "@shared/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

export interface IStorage {
  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(id: number): Promise<Agent | undefined>;
  createAgent(data: InsertAgent): Promise<Agent>;
  updateAgent(id: number, data: Partial<InsertAgent>): Promise<Agent | undefined>;
  deleteAgent(id: number): Promise<void>;

  // Shifts
  getShifts(): Promise<Shift[]>;
  getShiftsByAgent(agentId: number): Promise<Shift[]>;
  upsertShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<void>;

  // Weekly template apply
  applyWeekTemplate(agentId: number, startUtc: number, endUtc: number, offWeekend: number): Promise<Shift[]>;

  // Overtime
  getOvertimeLogs(): Promise<OvertimeLog[]>;
  getOvertimeByAgent(agentId: number): Promise<OvertimeLog[]>;
  createOvertimeLog(agentId: number, date: string, data: Partial<InsertOvertimeLog>): Promise<OvertimeLog>;
  updateOvertimeLog(id: number, data: Partial<InsertOvertimeLog>): Promise<OvertimeLog | undefined>;
  deleteOvertimeLog(id: number): Promise<void>;
  bulkDeleteOvertimeLogs(ids: number[]): Promise<void>;
  clearAllOvertimeLogs(): Promise<void>;
  replaceOvertimeLogs(data: Array<Omit<OvertimeLog, "id">>): Promise<void>;

  // Agent logs
  getAgentLogs(): Promise<AgentLog[]>;
  getAgentLogsByAgent(agentId: number): Promise<AgentLog[]>;
  createAgentLog(data: InsertAgentLog): Promise<AgentLog>;
  upsertRecentAgentLog(data: InsertAgentLog, dedupeWindowMs?: number): Promise<AgentLog>;
  deleteAgentLog(id: number): Promise<void>;
  clearAllAgentLogs(): Promise<void>;

  // Atomic find-or-create for overtime opportunity (prevents P0 duplicate-slot race)
  findOrCreateOpportunity(params: {
    date: string; dayOfWeek: number | null; origin: string;
    fromShiftId: number | null; coveredByAgentId: number | null;
    coverStartUtc: number | null; coverEndUtc: number | null;
    overtimeHours: number; toAgentId: number; nowIso: string;
  }): Promise<{ opportunity: OvertimeLog; isNew: boolean }>;

  // Overtime claims (multi-agent competing for same opportunity)
  getClaimsForOpportunity(opportunityId: number): Promise<OvertimeClaim[]>;
  getClaimsByAgent(agentId: number): Promise<OvertimeClaim[]>;
  createClaim(data: Omit<InsertOvertimeClaim, "claimOrder">): Promise<OvertimeClaim>;
  updateClaim(id: number, data: Partial<InsertOvertimeClaim>): Promise<OvertimeClaim | undefined>;
  cancelClaim(id: number, agentId: number): Promise<OvertimeClaim | undefined>;
  approveClaimAndRejectOthers(claimId: number, opportunityId: number): Promise<OvertimeClaim | undefined>;
  approveClaimAndUpdateOpportunity(claimId: number, opportunityId: number, agentId: number): Promise<OvertimeClaim | undefined>;
  deleteClaimsByOpportunity(opportunityId: number): Promise<void>;

  // Live break state
  startLiveBreak(agentId: number): Promise<Agent | undefined>;
  endLiveBreak(agentId: number): Promise<Agent | undefined>;

  // Absences (sick / vacation spans)
  getAbsences(): Promise<Absence[]>;
  createAbsence(data: InsertAbsence): Promise<Absence>;
  deleteAbsence(id: number): Promise<void>;

  // Backup / restore
  exportAll(): Promise<{ agents: Agent[]; shifts: Shift[]; overtime: OvertimeLog[]; logs: AgentLog[] }>;
  importAll(data: {
    agents: Array<Omit<Agent, "id"> & {
      shifts: Array<Omit<Shift, "id" | "agentId">>;
      historicalShifts?: Array<{ date: string; offWeekend: number; note?: string | null }>;
    }>;
    overtime?: Array<Omit<OvertimeLog, "id">>;
    logs?: Array<Omit<AgentLog, "id">>;
  }): Promise<void>;
}

export const storage: IStorage = {
  async getAgents() {
    return await db.select().from(agents);
  },
  async getAgent(id) {
    return await db.select().from(agents).where(eq(agents.id, id)).then(r => r[0]);
  },
  async createAgent(data) {
    return await db.insert(agents).values(data).returning().then(r => r[0]);
  },
  async updateAgent(id, data) {
    return await db.update(agents).set(data).where(eq(agents.id, id)).returning().then(r => r[0]);
  },
  async deleteAgent(id) {
    // Cascade: remove all related data atomically before deleting the agent
    await db.transaction(async (tx) => {
      await tx.delete(overtimeClaims).where(eq(overtimeClaims.agentId, id));
      await tx.delete(shifts).where(eq(shifts.agentId, id));
      await tx.delete(overtimeLog).where(eq(overtimeLog.agentId, id));
      await tx.delete(agentLogs).where(eq(agentLogs.agentId, id));
      await tx.delete(absences).where(eq(absences.agentId, id));
      await tx.delete(agents).where(eq(agents.id, id));
    });
  },

  async getShifts() {
    return await db.select().from(shifts);
  },
  async getShiftsByAgent(agentId) {
    return await db.select().from(shifts).where(eq(shifts.agentId, agentId));
  },
  async upsertShift(data) {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(shifts)
        .where(and(eq(shifts.agentId, data.agentId), eq(shifts.dayOfWeek, data.dayOfWeek)))
        .then(r => r[0]);
      if (existing) {
        return await tx.update(shifts).set(data).where(eq(shifts.id, existing.id)).returning().then(r => r[0]!);
      }
      return await tx.insert(shifts).values(data).returning().then(r => r[0]);
    });
  },
  async updateShift(id, data) {
    return await db.update(shifts).set(data).where(eq(shifts.id, id)).returning().then(r => r[0]);
  },
  async deleteShift(id) {
    await db.delete(shifts).where(eq(shifts.id, id));
  },

  async applyWeekTemplate(agentId, startUtc, endUtc, offWeekend) {
    return await db.transaction(async (tx) => {
      const offDays = offWeekend === 1 ? [0, 6] : [4, 5];
      const workDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !offDays.includes(d));

      for (const day of offDays) {
        const existing = await tx.select().from(shifts)
          .where(and(eq(shifts.agentId, agentId), eq(shifts.dayOfWeek, day)))
          .then(r => r[0]);
        if (existing) {
          await tx.delete(shifts).where(eq(shifts.id, existing.id));
        }
      }

      const result: Shift[] = [];
      for (const day of workDays) {
        const existing = await tx.select().from(shifts)
          .where(and(eq(shifts.agentId, agentId), eq(shifts.dayOfWeek, day)))
          .then(r => r[0]);
        if (existing) {
          const updated = await tx.update(shifts)
            .set({ startUtc, endUtc, activeStart: null, activeEnd: null })
            .where(eq(shifts.id, existing.id))
            .returning().then(r => r[0]!);
          result.push(updated);
        } else {
          const created = await tx.insert(shifts)
            .values({ agentId, dayOfWeek: day, startUtc, endUtc, activeStart: null, activeEnd: null, breakStart: null })
            .returning().then(r => r[0]);
          result.push(created);
        }
      }
      return result;
    });
  },

  async getOvertimeLogs() {
    return await db.select().from(overtimeLog);
  },
  async getOvertimeByAgent(agentId) {
    return await db.select().from(overtimeLog).where(eq(overtimeLog.agentId, agentId));
  },
  async createOvertimeLog(agentId, date, data) {
    return await db.insert(overtimeLog).values({ agentId, date, overtimeHours: 0, releasedHours: 0, ...data }).returning().then(r => r[0]);
  },
  async updateOvertimeLog(id, data) {
    return await db.update(overtimeLog).set(data).where(eq(overtimeLog.id, id)).returning().then(r => r[0]);
  },
  async deleteOvertimeLog(id) {
    await db.delete(overtimeLog).where(eq(overtimeLog.id, id));
  },
  async bulkDeleteOvertimeLogs(ids) {
    if (ids.length === 0) return;
    await db.delete(overtimeLog).where(inArray(overtimeLog.id, ids));
  },
  async clearAllOvertimeLogs() {
    await db.delete(overtimeLog);
  },
  async replaceOvertimeLogs(data) {
    await db.transaction(async (tx) => {
      await tx.delete(overtimeLog);
      for (const record of data) {
        await tx.insert(overtimeLog).values(record);
      }
    });
  },

  async getAgentLogs() {
    return await db.select().from(agentLogs).orderBy(desc(agentLogs.createdAt));
  },
  async getAgentLogsByAgent(agentId) {
    return await db.select().from(agentLogs).where(eq(agentLogs.agentId, agentId));
  },
  async createAgentLog(data) {
    return await db.insert(agentLogs).values(data).returning().then(r => r[0]);
  },
  async upsertRecentAgentLog(data, dedupeWindowMs = 5 * 60 * 1000) {
    return await db.transaction(async (tx) => {
      if (data.actionType && data.date) {
        const recent = (await tx.select().from(agentLogs)
          .where(and(
            eq(agentLogs.agentId, data.agentId),
            eq(agentLogs.actionType, data.actionType),
            eq(agentLogs.date, data.date),
          )))
          .filter(l => {
            const age = Date.now() - new Date(l.createdAt).getTime();
            return age < dedupeWindowMs;
          });
        if (recent.length > 0) {
          const latest = recent[recent.length - 1];
          return await tx.update(agentLogs)
            .set({ description: data.description, createdAt: new Date().toISOString() })
            .where(eq(agentLogs.id, latest.id))
            .returning().then(r => r[0]!);
        }
      }
      return await tx.insert(agentLogs).values(data).returning().then(r => r[0]);
    });
  },
  async deleteAgentLog(id) {
    await db.delete(agentLogs).where(eq(agentLogs.id, id));
  },
  async clearAllAgentLogs() {
    await db.delete(agentLogs);
  },

  async findOrCreateOpportunity({ date, dayOfWeek, origin, fromShiftId, coveredByAgentId, coverStartUtc, coverEndUtc, overtimeHours, toAgentId, nowIso }) {
    return await db.transaction(async (tx) => {
      const allRows = await tx.select().from(overtimeLog);
      const existing = allRows.find(r =>
        r.status === "pending" &&
        r.date === date &&
        r.dayOfWeek === dayOfWeek &&
        r.origin === origin &&
        r.fromShiftId === fromShiftId &&
        r.coveredByAgentId === coveredByAgentId &&
        r.coverStartUtc === coverStartUtc &&
        r.coverEndUtc === coverEndUtc
      );
      if (existing) return { opportunity: existing, isNew: false };

      const opp = await tx.insert(overtimeLog).values({
        agentId: toAgentId, date, overtimeHours, origin: origin as any,
        coveredByAgentId, status: "pending", statusUpdatedAt: nowIso,
        fromShiftId, dayOfWeek, coverStartUtc, coverEndUtc, releasedHours: 0, note: null,
      }).returning().then(r => r[0]);

      // First claim is created inside the same transaction
      const claims = await tx.select().from(overtimeClaims)
        .where(eq(overtimeClaims.opportunityId, opp.id));
      await tx.insert(overtimeClaims).values({
        opportunityId: opp.id, agentId: toAgentId,
        status: "pending", claimOrder: claims.length + 1,
        note: null, createdAt: nowIso,
      });

      return { opportunity: opp, isNew: true };
    });
  },

  // --- Overtime claims ---
  async getClaimsForOpportunity(opportunityId) {
    return (await db.select().from(overtimeClaims)
      .where(eq(overtimeClaims.opportunityId, opportunityId)))
      .sort((a, b) => a.claimOrder - b.claimOrder);
  },
  async getClaimsByAgent(agentId) {
    return await db.select().from(overtimeClaims)
      .where(eq(overtimeClaims.agentId, agentId));
  },
  async createClaim(data) {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(overtimeClaims)
        .where(eq(overtimeClaims.opportunityId, data.opportunityId));
      const nextOrder = existing.length + 1;
      return await tx.insert(overtimeClaims)
        .values({ ...data, claimOrder: nextOrder })
        .returning().then(r => r[0]);
    });
  },
  async updateClaim(id, data) {
    return await db.update(overtimeClaims).set(data).where(eq(overtimeClaims.id, id)).returning().then(r => r[0]);
  },
  async cancelClaim(id, agentId) {
    const claim = await db.select().from(overtimeClaims)
      .where(and(eq(overtimeClaims.id, id), eq(overtimeClaims.agentId, agentId)))
      .then(r => r[0]);
    if (!claim) return undefined;
    return await db.update(overtimeClaims)
      .set({ status: "cancelled" })
      .where(eq(overtimeClaims.id, id))
      .returning().then(r => r[0]);
  },
  async approveClaimAndRejectOthers(claimId, opportunityId) {
    return await db.transaction(async (tx) => {
      const approved = await tx.update(overtimeClaims)
        .set({ status: "approved" })
        .where(eq(overtimeClaims.id, claimId))
        .returning().then(r => r[0]);
      // Atomically reject all other pending claims for this opportunity
      const others = await tx.select().from(overtimeClaims)
        .where(and(eq(overtimeClaims.opportunityId, opportunityId), eq(overtimeClaims.status, "pending")));
      for (const other of others) {
        if (other.id !== claimId) {
          await tx.update(overtimeClaims).set({ status: "rejected" }).where(eq(overtimeClaims.id, other.id));
        }
      }
      return approved;
    });
  },
  async approveClaimAndUpdateOpportunity(claimId, opportunityId, agentId) {
    return await db.transaction(async (tx) => {
      const approved = await tx.update(overtimeClaims)
        .set({ status: "approved" })
        .where(eq(overtimeClaims.id, claimId))
        .returning().then(r => r[0]);
      const others = await tx.select().from(overtimeClaims)
        .where(and(eq(overtimeClaims.opportunityId, opportunityId), eq(overtimeClaims.status, "pending")));
      for (const other of others) {
        if (other.id !== claimId) {
          await tx.update(overtimeClaims).set({ status: "rejected" }).where(eq(overtimeClaims.id, other.id));
        }
      }
      await tx.update(overtimeLog)
        .set({ agentId, status: "approved", statusUpdatedAt: new Date().toISOString() })
        .where(eq(overtimeLog.id, opportunityId));
      return approved;
    });
  },
  async deleteClaimsByOpportunity(opportunityId) {
    await db.delete(overtimeClaims).where(eq(overtimeClaims.opportunityId, opportunityId));
  },

  async getAbsences() {
    return await db.select().from(absences);
  },
  async createAbsence(data) {
    return await db.insert(absences).values(data).returning().then(r => r[0]);
  },
  async deleteAbsence(id) {
    await db.delete(absences).where(eq(absences.id, id));
  },

  async startLiveBreak(agentId) {
    return await db.update(agents).set({ breakActiveAt: new Date().toISOString() })
      .where(eq(agents.id, agentId)).returning().then(r => r[0]);
  },
  async endLiveBreak(agentId) {
    return await db.update(agents).set({ breakActiveAt: null })
      .where(eq(agents.id, agentId)).returning().then(r => r[0]);
  },

  async exportAll() {
    return {
      agents: await db.select().from(agents),
      shifts: await db.select().from(shifts),
      overtime: await db.select().from(overtimeLog),
      logs: await db.select().from(agentLogs),
      claims: await db.select().from(overtimeClaims),
    } as any;
  },

  async importAll(data) {
    await db.transaction(async (tx) => {
      // Wipe all existing data atomically — rollback on any failure
      await tx.delete(overtimeClaims);
      await tx.delete(overtimeLog);
      await tx.delete(agentLogs);
      await tx.delete(absences);
      await tx.delete(shifts);
      await tx.delete(agents);

      const oldToNewAgentId = new Map<number, number>();
      const agentNameToId = new Map<string, number>();

      for (const agentData of data.agents) {
        const { shifts: agentShifts, historicalShifts, id: oldAgentId, ...agentFields } = agentData as any;
        const newAgent = await tx.insert(agents).values(agentFields).returning().then(r => r[0]);
        if (typeof oldAgentId === "number") {
          oldToNewAgentId.set(oldAgentId, newAgent.id);
        }
        agentNameToId.set((agentFields as any).name, newAgent.id);

        for (const s of (agentShifts ?? [])) {
          await tx.insert(shifts)
            .values({ ...s, agentId: newAgent.id, activeStart: null, activeEnd: null });
        }

        // Convert historical shifts to agent logs
        if (Array.isArray(historicalShifts)) {
          for (const hs of historicalShifts) {
            await tx.insert(agentLogs).values({
              agentId: newAgent.id,
              date: hs.date,
              type: "schedule_change",
              description: `Imported retroactive shift: ${hs.note || "Weekly pattern"}`,
              notes: hs.note || null,
              actionType: "admin_import",
              createdAt: new Date().toISOString(),
            });
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

          await tx.insert(overtimeLog).values({
            ...row,
            agentId: mappedAgentId,
            coveredByAgentId: mappedCoveredById,
            fromShiftId: null,
          });
        }
      }

      if (Array.isArray(data.logs)) {
        for (const row of data.logs) {
          const mappedAgentId = oldToNewAgentId.get(row.agentId);
          if (!mappedAgentId) continue;
          const mappedCoveredById = row.coveredByAgentId == null
            ? null
            : (oldToNewAgentId.get(row.coveredByAgentId) ?? null);

          await tx.insert(agentLogs).values({
            ...row,
            agentId: mappedAgentId,
            coveredByAgentId: mappedCoveredById,
          });
        }
      }
    });
  },
};
