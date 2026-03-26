import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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
});

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// Shifts table — per agent, per weekday (0=Sun, 1=Mon ... 6=Sat)
// start/end are hours in UTC (0–24, end can be > 24 for overnight)
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0-6
  startUtc: real("start_utc").notNull(), // 0..23.99
  endUtc: real("end_utc").notNull(),   // start..start+16 (can exceed 24 for overnight)
  // Lever adjustments for today's override
  activeStart: real("active_start"),   // null = same as startUtc
  activeEnd: real("active_end"),       // null = same as endUtc
  // Break: 30-min fixed duration, stored as UTC hour float (null = no break set)
  breakStart: real("break_start"),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

// Overtime log
export const overtimeLog = sqliteTable("overtime_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").notNull(),
  date: text("date").notNull(), // ISO date string
  overtimeHours: real("overtime_hours").notNull().default(0),
  releasedHours: real("released_hours").notNull().default(0),
  note: text("note"),
});

export const insertOvertimeLogSchema = createInsertSchema(overtimeLog).omit({ id: true });
export type InsertOvertimeLog = z.infer<typeof insertOvertimeLogSchema>;
export type OvertimeLog = typeof overtimeLog.$inferSelect;
