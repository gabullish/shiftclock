import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { agents, shifts } from "@shared/schema";

// Solflare-inspired agent default colors (yellow + dark accents)
const DEFAULT_COLORS = [
  "#FFD700", // gold
  "#FFA500", // amber
  "#FF6B35", // orange
  "#E63946", // red
  "#7B2FBE", // purple
  "#2196F3", // blue
  "#00BCD4", // cyan
  "#4CAF50", // green
  "#FF4081", // pink
  "#00E676", // lime
  "#FF9800", // deep orange
  "#9C27B0", // violet
  "#03A9F4", // light blue
];

// Default shifts — endUtc values >24 represent overnight shifts (e.g. 26 = 02:00 next day)
const DEFAULT_SHIFTS = [
  { dayRange: [1,5], startUtc: 0,  endUtc: 8  },
  { dayRange: [1,5], startUtc: 2,  endUtc: 10 },
  { dayRange: [1,5], startUtc: 4,  endUtc: 12 },
  { dayRange: [1,5], startUtc: 6,  endUtc: 14 },
  { dayRange: [1,5], startUtc: 8,  endUtc: 16 },
  { dayRange: [1,5], startUtc: 10, endUtc: 18 },
  { dayRange: [1,5], startUtc: 12, endUtc: 20 },
  { dayRange: [1,5], startUtc: 14, endUtc: 22 },
  { dayRange: [1,5], startUtc: 16, endUtc: 24 },
  { dayRange: [1,5], startUtc: 18, endUtc: 26 }, // 18:00–02:00 next day
  { dayRange: [1,5], startUtc: 20, endUtc: 28 }, // 20:00–04:00 next day
  { dayRange: [1,5], startUtc: 22, endUtc: 30 }, // 22:00–06:00 next day
  { dayRange: [1,5], startUtc: 1,  endUtc: 9  },
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Los_Angeles", "America/Sao_Paulo",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Singapore",
  "Australia/Sydney", "Pacific/Auckland", "Africa/Nairobi", "Asia/Dubai", "Asia/Kolkata"
];

async function seedDefaultData() {
  const existing = storage.getAgents();
  if (existing.length > 0) return;

  const createdAgents = [];
  for (let i = 1; i <= 13; i++) {
    const agent = storage.createAgent({
      name: `Agent ${i}`,
      color: DEFAULT_COLORS[(i - 1) % DEFAULT_COLORS.length],
      avatarUrl: null,
      timezone: TIMEZONES[(i - 1) % TIMEZONES.length],
      role: "Support Agent",
      offWeekend: 1,
      offCycleStart: null,
    });
    createdAgents.push(agent);
  }

  for (let i = 0; i < createdAgents.length; i++) {
    const agent = createdAgents[i];
    const shiftTemplate = DEFAULT_SHIFTS[i];
    // endUtc values >24 are intentional overnight markers — store as-is
    const endUtc = shiftTemplate.endUtc;
    for (let day = shiftTemplate.dayRange[0]; day <= shiftTemplate.dayRange[1]; day++) {
      storage.upsertShift({
        agentId: agent.id,
        dayOfWeek: day,
        startUtc: shiftTemplate.startUtc,
        endUtc,
        activeStart: null,
        activeEnd: null,
        breakStart: null,
      });
    }
  }
}

function runMigrations() {
  const safeAlter = (sql: string) => { try { db.run(sql); } catch { /* already exists */ } };
  safeAlter("ALTER TABLE shifts ADD COLUMN break_start REAL");
  safeAlter("ALTER TABLE agents ADD COLUMN off_weekend INTEGER NOT NULL DEFAULT 1");
  safeAlter("ALTER TABLE agents ADD COLUMN off_cycle_start TEXT");
  safeAlter(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      cover_pct REAL,
      covered_by_agent_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // New columns for overtime approval flow
  safeAlter("ALTER TABLE overtime_log ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN origin TEXT");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN covered_by_agent_id INTEGER");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN status_updated_at TEXT");
  // New columns for activity log
  safeAlter("ALTER TABLE agent_logs ADD COLUMN action_type TEXT");
  safeAlter("ALTER TABLE agent_logs ADD COLUMN description TEXT");
}

export async function registerRoutes(httpServer: Server, app: Express) {
  runMigrations();
  await seedDefaultData();

  // --- Agents ---
  app.get("/api/agents", (_req, res) => {
    res.json(storage.getAgents());
  });

  app.post("/api/agents", (req, res) => {
    const agent = storage.createAgent(req.body);
    res.json(agent);
  });

  app.patch("/api/agents/:id", (req, res) => {
    const agent = storage.updateAgent(Number(req.params.id), req.body);
    if (!agent) return res.status(404).json({ message: "Not found" });
    res.json(agent);
  });

  app.delete("/api/agents/:id", (req, res) => {
    storage.deleteAgent(Number(req.params.id));
    res.json({ ok: true });
  });

  // --- Apply week template ---
  app.post("/api/agents/:id/apply-week", (req, res) => {
    const agentId = Number(req.params.id);
    const agent = storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const { startUtc, endUtc } = req.body;
    if (typeof startUtc !== "number" || typeof endUtc !== "number") {
      return res.status(400).json({ message: "startUtc and endUtc required" });
    }
    // Normalize overnight: if end <= start, add 24 to represent next-day end
    const normEnd = endUtc <= startUtc ? endUtc + 24 : endUtc;
    const updatedShifts = storage.applyWeekTemplate(agentId, startUtc, normEnd, agent.offWeekend ?? 1);
    res.json(updatedShifts);
  });

  // --- Shifts ---
  app.get("/api/shifts", (_req, res) => {
    res.json(storage.getShifts());
  });

  app.post("/api/shifts", (req, res) => {
    const shift = storage.upsertShift(req.body);
    res.json(shift);
  });

  app.patch("/api/shifts/:id", (req, res) => {
    const shift = storage.updateShift(Number(req.params.id), req.body);
    if (!shift) return res.status(404).json({ message: "Not found" });
    res.json(shift);
  });

  app.delete("/api/shifts/:id", (req, res) => {
    storage.deleteShift(Number(req.params.id));
    res.json({ ok: true });
  });

  // --- Overtime ---
  app.get("/api/overtime", (_req, res) => {
    res.json(storage.getOvertimeLogs());
  });

  app.post("/api/overtime", (req, res) => {
    const { agentId, date, ...rest } = req.body;
    const log = storage.upsertOvertimeLog(agentId, date, rest);
    res.json(log);
  });

  // Update overtime record status (approve / deny / paid)
  app.patch("/api/overtime/:id", (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!status || !["pending", "approved", "denied", "paid"].includes(status)) {
      return res.status(400).json({ message: "Valid status required: pending|approved|denied|paid" });
    }
    const updated = storage.updateOvertimeLog(id, { status, statusUpdatedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ message: "Not found" });

    // Log the status change
    const agents = storage.getAgents();
    const agent = agents.find(a => a.id === updated.agentId);
    if (agent) {
      storage.createAgentLog({
        agentId: updated.agentId,
        date: updated.date,
        type: "overtime-status",
        coverPct: null,
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "overtime-status-changed",
        description: `Manager ${status} ${agent.name}'s overtime for ${updated.date} shift (${updated.overtimeHours.toFixed(1)}h).`,
      });
    }
    res.json(updated);
  });

  // Assign freed overtime from one agent to another
  app.post("/api/overtime/assign", (req, res) => {
    const { fromShiftId, toAgentId, hours, date, dayOfWeek } = req.body;
    if (!fromShiftId || !toAgentId || !hours || !date) {
      return res.status(400).json({ message: "fromShiftId, toAgentId, hours, and date required" });
    }

    const fromShift = storage.getShifts().find(s => s.id === fromShiftId);
    if (!fromShift) return res.status(404).json({ message: "Source shift not found" });

    const allAgents = storage.getAgents();
    const fromAgent = allAgents.find(a => a.id === fromShift.agentId);
    const toAgent = allAgents.find(a => a.id === toAgentId);
    if (!fromAgent || !toAgent) return res.status(404).json({ message: "Agent not found" });

    // Reset the freeing agent's shift — restore activeEnd to match original endUtc
    const normEnd = fromShift.endUtc <= fromShift.startUtc ? fromShift.endUtc + 24 : fromShift.endUtc;
    storage.updateShift(fromShift.id, { activeEnd: normEnd });

    // Extend the receiving agent's shift on that day
    const toShifts = storage.getShifts().filter(s => s.agentId === toAgentId && s.dayOfWeek === (dayOfWeek ?? fromShift.dayOfWeek));
    if (toShifts.length > 0) {
      const toShift = toShifts[0];
      const curEnd = toShift.activeEnd ?? (toShift.endUtc <= toShift.startUtc ? toShift.endUtc + 24 : toShift.endUtc);
      storage.updateShift(toShift.id, { activeEnd: curEnd + hours });
    }

    // Create overtime record for the receiving agent
    const otLog = storage.upsertOvertimeLog(toAgentId, date, {
      overtimeHours: hours,
      origin: "claimed-from-agent",
      coveredByAgentId: fromShift.agentId,
      status: "pending",
      statusUpdatedAt: new Date().toISOString(),
    });

    // Log: freed segment removed
    storage.createAgentLog({
      agentId: fromShift.agentId,
      date,
      type: "shift-claim",
      coverPct: null,
      coveredByAgentId: toAgentId,
      notes: null,
      createdAt: new Date().toISOString(),
      actionType: "shift-claimed",
      description: `${toAgent.name} claimed ${hours.toFixed(1)}h freed from ${fromAgent.name}'s ${date} shift.`,
    });

    res.json({ ok: true, overtimeLog: otLog });
  });

  // --- Agent Logs ---
  app.get("/api/agent-logs", (_req, res) => {
    res.json(storage.getAgentLogs());
  });

  app.get("/api/agent-logs/:agentId", (req, res) => {
    res.json(storage.getAgentLogsByAgent(Number(req.params.agentId)));
  });

  app.post("/api/agent-logs", (req, res) => {
    const { agentId, date, type, coverPct, coveredByAgentId, notes, actionType, description } = req.body;
    if (!agentId || !date || !type) {
      return res.status(400).json({ message: "agentId, date and type are required" });
    }
    const log = storage.createAgentLog({
      agentId,
      date,
      type,
      coverPct: coverPct ?? null,
      coveredByAgentId: coveredByAgentId ?? null,
      notes: notes ?? null,
      createdAt: new Date().toISOString(),
      actionType: actionType ?? null,
      description: description ?? null,
    });
    res.json(log);
  });

  app.delete("/api/agent-logs/:id", (req, res) => {
    storage.deleteAgentLog(Number(req.params.id));
    res.json({ ok: true });
  });
}
