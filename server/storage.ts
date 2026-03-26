import { db } from "./db";
import { agents, shifts, overtimeLog } from "@shared/schema";
import type { Agent, InsertAgent, Shift, InsertShift, OvertimeLog, InsertOvertimeLog } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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

  // Overtime
  getOvertimeLogs(): OvertimeLog[];
  getOvertimeByAgent(agentId: number): OvertimeLog[];
  upsertOvertimeLog(agentId: number, date: string, data: Partial<InsertOvertimeLog>): OvertimeLog;
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
    db.delete(agents).where(eq(agents.id, id)).run();
  },

  getShifts() {
    return db.select().from(shifts).all();
  },
  getShiftsByAgent(agentId) {
    return db.select().from(shifts).where(eq(shifts.agentId, agentId)).all();
  },
  upsertShift(data) {
    // Check if shift exists for agent+day
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

  getOvertimeLogs() {
    return db.select().from(overtimeLog).all();
  },
  getOvertimeByAgent(agentId) {
    return db.select().from(overtimeLog).where(eq(overtimeLog.agentId, agentId)).all();
  },
  upsertOvertimeLog(agentId, date, data) {
    const existing = db.select().from(overtimeLog)
      .where(and(eq(overtimeLog.agentId, agentId), eq(overtimeLog.date, date)))
      .get();
    if (existing) {
      return db.update(overtimeLog).set(data).where(eq(overtimeLog.id, existing.id)).returning().get()!;
    }
    return db.insert(overtimeLog).values({ agentId, date, overtimeHours: 0, releasedHours: 0, ...data }).returning().get();
  },
};
