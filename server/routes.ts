import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { agents, shifts } from "@shared/schema";

type NormalizedBackup = {
  agents: Array<Record<string, unknown> & { id?: number; shifts: Array<Record<string, unknown>> }>;
  overtime: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || "";

function readAdminHeaderToken(req: Request): string {
  const raw = req.headers["x-admin-token"];
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return (raw || "").trim();
}

/** Middleware: reject non-admin requests to mutating endpoints */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ message: "Server misconfigured: ADMIN_TOKEN is not set" });
  }
  if (readAdminHeaderToken(req) === ADMIN_TOKEN) return next();
  res.status(403).json({ message: "Admin access required" });
}

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
  // New columns for approval-gated assignment
  safeAlter("ALTER TABLE overtime_log ADD COLUMN from_shift_id INTEGER");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN day_of_week INTEGER");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN cover_start_utc REAL");
  safeAlter("ALTER TABLE overtime_log ADD COLUMN cover_end_utc REAL");

  // Hot-path indexes for dashboard and overtime workflows.
  safeAlter("CREATE INDEX IF NOT EXISTS idx_shifts_agent_day ON shifts(agent_id, day_of_week)");
  safeAlter("CREATE INDEX IF NOT EXISTS idx_overtime_agent_date_status ON overtime_log(agent_id, date, status)");
  safeAlter("CREATE INDEX IF NOT EXISTS idx_overtime_from_shift_status ON overtime_log(from_shift_id, status)");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeImportPayload(payload: unknown): NormalizedBackup {
  const body = (payload ?? {}) as Record<string, unknown>;
  const rawAgents = Array.isArray(body.agents) ? body.agents : null;
  if (!rawAgents) {
    throw new Error("agents array required");
  }

  const rawShifts = Array.isArray(body.shifts) ? body.shifts : [];
  const rawOvertime = Array.isArray(body.overtime) ? body.overtime : [];
  const rawLogs = Array.isArray(body.logs) ? body.logs : [];

  const shiftsByAgentId = new Map<number, Array<Record<string, unknown>>>();
  for (const s of rawShifts) {
    const row = s as Record<string, unknown>;
    if (typeof row.agentId !== "number") continue;
    const current = shiftsByAgentId.get(row.agentId) ?? [];
    current.push(row);
    shiftsByAgentId.set(row.agentId, current);
  }

  const normalizedAgents = rawAgents.map((agentItem) => {
    const row = agentItem as Record<string, unknown>;
    const nestedShifts = Array.isArray(row.shifts)
      ? (row.shifts as Array<Record<string, unknown>>)
      : (typeof row.id === "number" ? (shiftsByAgentId.get(row.id) ?? []) : []);

    const cleanedNestedShifts = nestedShifts
      .filter((s) => typeof (s as Record<string, unknown>).dayOfWeek === "number")
      .map((s) => {
        const shiftRow = s as Record<string, unknown>;
        return {
          dayOfWeek: Number(shiftRow.dayOfWeek),
          startUtc: Number(shiftRow.startUtc),
          endUtc: Number(shiftRow.endUtc),
          breakStart: typeof shiftRow.breakStart === "number" ? shiftRow.breakStart : null,
        };
      });

    return {
      id: typeof row.id === "number" ? row.id : undefined,
      name: typeof row.name === "string" ? row.name : "Unnamed Agent",
      color: typeof row.color === "string" ? row.color : "#4CAF50",
      avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
      timezone: typeof row.timezone === "string" ? row.timezone : "UTC",
      role: typeof row.role === "string" ? row.role : "Support Agent",
      offWeekend: typeof row.offWeekend === "number" ? row.offWeekend : 1,
      offCycleStart: typeof row.offCycleStart === "string" ? row.offCycleStart : null,
      shifts: cleanedNestedShifts,
    };
  });

  const cleanedOvertime = rawOvertime
    .filter((item) => {
      const row = item as Record<string, unknown>;
      return typeof row.agentId === "number" && isIsoDate(row.date);
    })
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        agentId: row.agentId as number,
        date: row.date as string,
        overtimeHours: typeof row.overtimeHours === "number" ? row.overtimeHours : 0,
        releasedHours: typeof row.releasedHours === "number" ? row.releasedHours : 0,
        note: typeof row.note === "string" ? row.note : null,
        status: typeof row.status === "string" ? row.status : "pending",
        origin: typeof row.origin === "string" ? row.origin : null,
        coveredByAgentId: typeof row.coveredByAgentId === "number" ? row.coveredByAgentId : null,
        statusUpdatedAt: typeof row.statusUpdatedAt === "string" ? row.statusUpdatedAt : null,
        fromShiftId: typeof row.fromShiftId === "number" ? row.fromShiftId : null,
        dayOfWeek: typeof row.dayOfWeek === "number" ? row.dayOfWeek : null,
        coverStartUtc: typeof row.coverStartUtc === "number" ? row.coverStartUtc : null,
        coverEndUtc: typeof row.coverEndUtc === "number" ? row.coverEndUtc : null,
      };
    });

  const cleanedLogs = rawLogs
    .filter((item) => {
      const row = item as Record<string, unknown>;
      return typeof row.agentId === "number" && isIsoDate(row.date) && typeof row.type === "string";
    })
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        agentId: row.agentId as number,
        date: row.date as string,
        type: row.type as string,
        coverPct: typeof row.coverPct === "number" ? row.coverPct : null,
        coveredByAgentId: typeof row.coveredByAgentId === "number" ? row.coveredByAgentId : null,
        notes: typeof row.notes === "string" ? row.notes : null,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
        actionType: typeof row.actionType === "string" ? row.actionType : null,
        description: typeof row.description === "string" ? row.description : null,
      };
    });

  return {
    agents: normalizedAgents,
    overtime: cleanedOvertime,
    logs: cleanedLogs,
  };
}

export async function registerRoutes(httpServer: Server, app: Express) {
  if (!ADMIN_TOKEN) {
    console.warn("[routes] ADMIN_TOKEN is not configured. Mutating admin routes will return 500.");
  }
  runMigrations();
  await seedDefaultData();

  // --- Agents ---
  app.get("/api/admin/verify", (req, res) => {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ message: "Server misconfigured: ADMIN_TOKEN is not set" });
    }
    if (readAdminHeaderToken(req) !== ADMIN_TOKEN) {
      return res.status(401).json({ message: "Invalid admin token" });
    }
    return res.json({ ok: true });
  });

  app.get("/api/agents", (_req, res) => {
    res.json(storage.getAgents());
  });

  app.post("/api/agents", requireAdmin, (req, res) => {
    const agent = storage.createAgent(req.body);
    res.json(agent);
  });

  app.patch("/api/agents/:id", requireAdmin, (req, res) => {
    const agent = storage.updateAgent(Number(req.params.id), req.body);
    if (!agent) return res.status(404).json({ message: "Not found" });
    res.json(agent);
  });

  app.delete("/api/agents/:id", requireAdmin, (req, res) => {
    storage.deleteAgent(Number(req.params.id));
    res.json({ ok: true });
  });

  // --- Apply week template ---
  app.post("/api/agents/:id/apply-week", requireAdmin, (req, res) => {
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

  app.post("/api/shifts", requireAdmin, (req, res) => {
    const shift = storage.upsertShift(req.body);
    res.json(shift);
  });

  app.patch("/api/shifts/:id", requireAdmin, (req, res) => {
    const shift = storage.updateShift(Number(req.params.id), req.body);
    if (!shift) return res.status(404).json({ message: "Not found" });
    res.json(shift);
  });

  app.delete("/api/shifts/:id", requireAdmin, (req, res) => {
    storage.deleteShift(Number(req.params.id));
    res.json({ ok: true });
  });

  // --- Overtime ---
  app.get("/api/overtime", (_req, res) => {
    res.json(storage.getOvertimeLogs());
  });

  app.post("/api/overtime", requireAdmin, (req, res) => {
    const { agentId, date, ...rest } = req.body;
    const log = storage.createOvertimeLog(agentId, date, rest);
    res.json(log);
  });

  // Update overtime record status (approve / deny / paid)
  app.patch("/api/overtime/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!status || !["pending", "approved", "denied", "paid"].includes(status)) {
      return res.status(400).json({ message: "Valid status required: pending|approved|denied|paid" });
    }
    // Get current record to know old status before updating
    const existing = storage.getOvertimeLogs().find(r => r.id === id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    const updated = storage.updateOvertimeLog(id, { status, statusUpdatedAt: new Date().toISOString() });
    if (!updated) return res.status(404).json({ message: "Not found" });

    // When a claimed-from-agent record is approved (and wasn't already), no shift extension needed.
    // The coverage slot is stored in coverStartUtc/coverEndUtc and rendered as a separate bar.
    // (Previously this extended the receiver's activeEnd — that was wrong.)

    // When reverting from approved (to pending/denied), no shift changes needed.
    // Coverage is rendered from the OT record's status, not from shift activeEnd.

    // Log the status change (deduped — rapid clicks collapse into one entry)
    const agents = storage.getAgents();
    const agent = agents.find(a => a.id === updated.agentId);
    if (agent) {
      storage.upsertRecentAgentLog({
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

  // Delete a single overtime record (undo a demo/test assignment)
  app.delete("/api/overtime/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const existing = storage.getOvertimeLogs().find(r => r.id === id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    storage.deleteOvertimeLog(id);
    res.json({ ok: true });
  });

  // Bulk delete overtime records by id list
  app.delete("/api/overtime", requireAdmin, (req, res) => {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.some(i => typeof i !== "number")) {
      return res.status(400).json({ message: "ids must be an array of numbers" });
    }
    storage.bulkDeleteOvertimeLogs(ids as number[]);
    res.json({ ok: true });
  });

  // Clear all overtime records
  app.delete("/api/overtime/all", requireAdmin, (_req, res) => {
    storage.clearAllOvertimeLogs();
    res.json({ ok: true });
  });

  // Replace overtime records from uploaded JSON
  app.post("/api/overtime/import", requireAdmin, (req, res) => {
    const { records } = req.body as { records?: unknown };
    if (!Array.isArray(records)) {
      return res.status(400).json({ message: "records array required" });
    }

    const cleaned = records
      .filter((row) => {
        const item = row as Record<string, unknown>;
        return typeof item.agentId === "number" && isIsoDate(item.date);
      })
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          agentId: item.agentId as number,
          date: item.date as string,
          overtimeHours: typeof item.overtimeHours === "number" ? item.overtimeHours : 0,
          releasedHours: typeof item.releasedHours === "number" ? item.releasedHours : 0,
          note: typeof item.note === "string" ? item.note : null,
          status: typeof item.status === "string" ? item.status : "pending",
          origin: typeof item.origin === "string" ? item.origin : null,
          coveredByAgentId: typeof item.coveredByAgentId === "number" ? item.coveredByAgentId : null,
          statusUpdatedAt: typeof item.statusUpdatedAt === "string" ? item.statusUpdatedAt : null,
          fromShiftId: typeof item.fromShiftId === "number" ? item.fromShiftId : null,
          dayOfWeek: typeof item.dayOfWeek === "number" ? item.dayOfWeek : null,
          coverStartUtc: typeof item.coverStartUtc === "number" ? item.coverStartUtc : null,
          coverEndUtc: typeof item.coverEndUtc === "number" ? item.coverEndUtc : null,
        };
      });

    storage.replaceOvertimeLogs(cleaned as any);
    res.json({ ok: true, count: cleaned.length });
  });

  // Assign freed overtime from one agent to another
  app.post("/api/overtime/assign", requireAdmin, (req, res) => {
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

    // Calculate the exact freed timeslot from the shrunk shift
    const normEnd = fromShift.endUtc <= fromShift.startUtc ? fromShift.endUtc + 24 : fromShift.endUtc;
    const curActiveEnd = fromShift.activeEnd ?? normEnd;
    // The freed slot is from curActiveEnd to curActiveEnd + hours
    const coverStartUtc = curActiveEnd;
    const coverEndUtc = curActiveEnd + hours;

    // Create overtime record with the exact coverage timeslot (pending approval)
    const otLog = storage.createOvertimeLog(toAgentId, date, {
      overtimeHours: hours,
      origin: "claimed-from-agent",
      coveredByAgentId: fromShift.agentId,
      status: "pending",
      statusUpdatedAt: new Date().toISOString(),
      fromShiftId: fromShift.id,
      dayOfWeek: dayOfWeek ?? fromShift.dayOfWeek,
      coverStartUtc,
      coverEndUtc,
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

    // Clear all agent logs
    app.delete("/api/agent-logs", requireAdmin, (_req, res) => {
      storage.clearAllAgentLogs();
      res.json({ ok: true });
    });

  app.get("/api/agent-logs/:agentId", (req, res) => {
    res.json(storage.getAgentLogsByAgent(Number(req.params.agentId)));
  });

  app.post("/api/agent-logs", requireAdmin, (req, res) => {
    const { agentId, date, type, coverPct, coveredByAgentId, notes, actionType, description } = req.body;
    if (!agentId || !date || !type) {
      return res.status(400).json({ message: "agentId, date and type are required" });
    }
    const log = storage.upsertRecentAgentLog({
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

    // --- Backup / Restore ---
    app.get("/api/export", requireAdmin, (_req, res) => {
      const data = storage.exportAll();
      res.json({ ...data, exportedAt: new Date().toISOString(), version: 1 });
    });

  app.post("/api/import", requireAdmin, (req, res) => {
    try {
      const normalized = normalizeImportPayload(req.body);
      storage.importAll({
        agents: normalized.agents as any,
        overtime: normalized.overtime as any,
        logs: normalized.logs as any,
      });
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid import payload";
      res.status(400).json({ message });
    }
  });
}
