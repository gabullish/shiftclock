import { db } from "./db";
import { agents, shifts, overtimeLog } from "@shared/schema";
import type { Agent, InsertAgent, Shift, InsertShift, OvertimeLog, InsertOvertimeLog } from "@shared/schema";
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
    // offWeekend=1 => days off are Sat(6) and Sun(0); offWeekend=0 => days off are Thu(4) and Fri(5)
    const offDays = offWeekend === 1 ? [0, 6] : [4, 5];
    const workDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !offDays.includes(d));

    // Delete shifts for off-days (they should show as off)
    for (const day of offDays) {
      const existing = db.select().from(shifts)
        .where(and(eq(shifts.agentId, agentId), eq(shifts.dayOfWeek, day)))
        .get();
      if (existing) {
        db.delete(shifts).where(eq(shifts.id, existing.id)).run();
      }
    }

    // Upsert shifts for work days
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
