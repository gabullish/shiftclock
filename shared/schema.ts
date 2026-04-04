import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Agents table
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  role: text("role").notNull().default("Agent"),
  // 1 = Sat/Sun off (default), 0 = Thu/Fri off
  offWeekend: integer("off_weekend").notNull().default(1),
  // ISO date string of the Monday when the toggle was last changed
  offCycleStart: text("off_cycle_start"),
  breakActiveAt: text("break_active_at"),
});

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// Shifts table — per agent, per weekday (0=Sun, 1=Mon ... 6=Sat)
// start/end are hours in UTC (0–23.99, endUtc can exceed 24 for overnight e.g. 23–7 stored as 23–31)
export const shifts = sqliteTable(
  "shifts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: integer("agent_id").notNull(),
    dayOfWeek: integer("day_of_week").notNull(), // 0-6
    startUtc: real("start_utc").notNull(), // 0..23.99
    endUtc: real("end_utc").notNull(),     // can exceed 24 for overnight (e.g. 31 = 07:00 next day)
    // Lever adjustments for today's override
    activeStart: real("active_start"),   // null = same as startUtc
    activeEnd: real("active_end"),       // null = same as endUtc
    // Break: 30-min fixed duration, stored as UTC hour float (null = no break set)
    breakStart: real("break_start"),
  },
  (table) => ({
    shiftsAgentDayIdx: index("idx_shifts_agent_day").on(table.agentId, table.dayOfWeek),
  })
);

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

// Overtime log
export const overtimeLog = sqliteTable(
  "overtime_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: integer("agent_id").notNull(),
    date: text("date").notNull(), // ISO date string
    overtimeHours: real("overtime_hours").notNull().default(0),
    releasedHours: real("released_hours").notNull().default(0),
    note: text("note"),
    // New columns for approval flow
    status: text("status").notNull().default("pending"), // pending | approved | denied | paid
    origin: text("origin"), // manager-extended | claimed-from-agent
    coveredByAgentId: integer("covered_by_agent_id"), // nullable — who freed the time (for claims)
    statusUpdatedAt: text("status_updated_at"),
    // Source shift info for approval-gated assignment
    fromShiftId: integer("from_shift_id"),
    dayOfWeek: integer("day_of_week"),
    // Exact UTC timeslot being covered (the slot the freeing agent gave up)
    coverStartUtc: real("cover_start_utc"),
    coverEndUtc: real("cover_end_utc"),
  },
  (table) => ({
    overtimeAgentDateStatusIdx: index("idx_overtime_agent_date_status").on(table.agentId, table.date, table.status),
    overtimeFromShiftStatusIdx: index("idx_overtime_from_shift_status").on(table.fromShiftId, table.status),
  })
);

export const insertOvertimeLogSchema = createInsertSchema(overtimeLog).omit({ id: true });
export type InsertOvertimeLog = z.infer<typeof insertOvertimeLogSchema>;
export type OvertimeLog = typeof overtimeLog.$inferSelect;

// Agent logs — tracks absences, partial coverage, who covered whom
export const agentLogs = sqliteTable("agent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").notNull(),
  date: text("date").notNull(),         // ISO date string YYYY-MM-DD
  // Type: sick | vacation | partial | overtime-taken
  type: text("type").notNull(),
  // For partial: how much of the shift was covered (0–100)
  coverPct: real("cover_pct"),
  // Who picked up the uncovered portion (nullable)
  coveredByAgentId: integer("covered_by_agent_id"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  // New columns for activity log
  actionType: text("action_type"), // shift-freed | shift-claimed | overtime-extended | overtime-status-changed | agent-added | agent-removed | shift-updated
  description: text("description"), // human-readable plain language string
});

export const insertAgentLogSchema = createInsertSchema(agentLogs).omit({ id: true });
export type InsertAgentLog = z.infer<typeof insertAgentLogSchema>;
export type AgentLog = typeof agentLogs.$inferSelect;

// Overtime claims — multiple agents competing for the same gap/opportunity
// opportunityId references overtime_log.id (the gap or shrink opportunity)
export const overtimeClaims = sqliteTable(
  "overtime_claims",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull(), // FK to overtime_log
    agentId: integer("agent_id").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | cancelled
    claimOrder: integer("claim_order").notNull(), // 1=first, 2=second, etc.
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    claimsOpportunityIdx: index("idx_claims_opportunity").on(table.opportunityId, table.status),
    claimsAgentIdx: index("idx_claims_agent").on(table.agentId, table.status),
  })
);

export const insertOvertimeClaimSchema = createInsertSchema(overtimeClaims).omit({ id: true });
export type InsertOvertimeClaim = z.infer<typeof insertOvertimeClaimSchema>;
export type OvertimeClaim = typeof overtimeClaims.$inferSelect;
