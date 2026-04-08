import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { createHmac } from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { agents, shifts } from "@shared/schema";

type NormalizedBackup = {
  agents: Array<Record<string, unknown> & { id?: number; shifts: Array<Record<string, unknown>> }>;
  overtime: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || "";
const AGENT_PASSWORD = process.env.AGENT_PASSWORD?.trim() || "";
// Derive agent session secret from admin token so no extra env var is required
const AGENT_SESSION_SECRET = createHmac("sha256", ADMIN_TOKEN || "shiftclock-agent-secret")
  .update("agent-session-v1")
  .digest("hex");
// Agent sessions are valid for 2 hours server-side; idle timeout is enforced client-side (4 min)
const AGENT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function makeAgentToken(agentId: number): string {
  const ts = Date.now();
  const payload = `${agentId}:${ts}`;
  const mac = createHmac("sha256", AGENT_SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${mac}`).toString("base64url");
}

function verifyAgentToken(token: string): { agentId: number; ts: number } | null {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length !== 3) return null;
    const [agentIdStr, tsStr, mac] = parts;
    const payload = `${agentIdStr}:${tsStr}`;
    const expected = createHmac("sha256", AGENT_SESSION_SECRET).update(payload).digest("hex");
    if (mac !== expected) return null;
    const ts = Number(tsStr);
    if (Date.now() - ts > AGENT_SESSION_TTL_MS) return null;
    return { agentId: Number(agentIdStr), ts };
  } catch {
    return null;
  }
}

function readAgentSessionToken(req: Request): string {
  const raw = req.headers["x-agent-session"];
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return (raw || "").trim();
}

/** Extracts verified agentId from request, or null */
function getAgentSession(req: Request): number | null {
  const token = readAgentSessionToken(req);
  if (!token) return null;
  const result = verifyAgentToken(token);
  return result ? result.agentId : null;
}

/** Middleware: requires a valid agent session and attaches agentId to req */
function requireAgentSession(req: Request & { agentId?: number }, res: Response, next: NextFunction) {
  const agentId = getAgentSession(req);
  if (!agentId) return res.status(401).json({ message: "Agent session required" });
  req.agentId = agentId;
  next();
}

function readAdminHeaderToken(req: Request): string {
  const raw = req.headers["x-admin-token"];
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return (raw || "").trim();
}

function isAdminRequest(req: Request): boolean {
  if (!ADMIN_TOKEN) return false;
  return readAdminHeaderToken(req) === ADMIN_TOKEN;
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
  // Multi-agent competing claims
  safeAlter(`
    CREATE TABLE IF NOT EXISTS overtime_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_order INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeAlter("CREATE INDEX IF NOT EXISTS idx_claims_opportunity ON overtime_claims(opportunity_id, status)");
  safeAlter("CREATE INDEX IF NOT EXISTS idx_claims_agent ON overtime_claims(agent_id, status)");
  // Live break state
  safeAlter("ALTER TABLE agents ADD COLUMN break_active_at TEXT");
}

function normaliseEndUtcServer(startUtc: number, endUtc: number): number {
  return endUtc <= startUtc ? endUtc + 24 : endUtc;
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
  if (!AGENT_PASSWORD) {
    console.warn("[routes] AGENT_PASSWORD is not configured. Agent mode will be disabled.");
  }
  runMigrations();
  await seedDefaultData();

  // --- Agent session auth ---
  app.post("/api/auth/agent-session", (req, res) => {
    if (!AGENT_PASSWORD) {
      return res.status(503).json({ message: "Agent mode is not configured on this server." });
    }
    const { password, agentId } = req.body as { password?: string; agentId?: number };
    if (!password || password.trim() !== AGENT_PASSWORD) {
      return res.status(401).json({ message: "Invalid agent password" });
    }
    if (!agentId || typeof agentId !== "number") {
      return res.status(400).json({ message: "agentId required" });
    }
    const agent = storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    const token = makeAgentToken(agentId);
    return res.json({ token, agentId, agentName: agent.name });
  });

  app.get("/api/auth/agent-session", (req, res) => {
    const token = readAgentSessionToken(req);
    if (!token) return res.status(401).json({ message: "No session token" });
    const result = verifyAgentToken(token);
    if (!result) return res.status(401).json({ message: "Invalid or expired session" });
    const agent = storage.getAgent(result.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    return res.json({ agentId: result.agentId, agentName: agent.name });
  });

  app.get("/api/auth/agent-password-configured", (_req, res) => {
    res.json({ configured: Boolean(AGENT_PASSWORD) });
  });

  // --- Admin verify ---
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

  app.patch("/api/agents/:id", (req, res) => {
    const targetId = Number(req.params.id);
    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);

    if (!admin && sessionAgentId !== targetId) {
      return res.status(403).json({ message: "You can only edit your own profile" });
    }

    const allowedForAgent = ["name", "color", "timezone", "avatarUrl"] as const;
    const payload = admin
      ? req.body
      : Object.fromEntries(
          Object.entries(req.body as Record<string, unknown>).filter(([k]) =>
            (allowedForAgent as readonly string[]).includes(k),
          ),
        );

    const agent = storage.updateAgent(targetId, payload);
    if (!agent) return res.status(404).json({ message: "Not found" });
    res.json(agent);
  });

  app.delete("/api/agents/:id", requireAdmin, (req, res) => {
    storage.deleteAgent(Number(req.params.id));
    res.json({ ok: true });
  });

  // --- Live break state ---
  app.post("/api/agents/:id/break/start", (req, res) => {
    const id = Number(req.params.id);
    if (!isAdminRequest(req) && getAgentSession(req) !== id) {
      return res.status(403).json({ message: "You can only manage your own break" });
    }
    const agent = storage.startLiveBreak(id);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const date = new Date().toISOString().slice(0, 10);
    storage.createAgentLog({
      agentId: id, date, type: "break", coverPct: null, coveredByAgentId: null,
      notes: null, createdAt: new Date().toISOString(), actionType: "break-started",
      description: `${agent.name} went on break.`,
    });
    res.json(agent);
  });

  app.post("/api/agents/:id/break/end", (req, res) => {
    const id = Number(req.params.id);
    if (!isAdminRequest(req) && getAgentSession(req) !== id) {
      return res.status(403).json({ message: "You can only manage your own break" });
    }
    const agent = storage.endLiveBreak(id);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const date = new Date().toISOString().slice(0, 10);
    storage.createAgentLog({
      agentId: id, date, type: "break", coverPct: null, coveredByAgentId: null,
      notes: null, createdAt: new Date().toISOString(), actionType: "break-ended",
      description: `${agent.name} returned from break.`,
    });
    res.json(agent);
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

  // BUG-03: Reset all lever adjustments + pending OT for a given day
  app.post("/api/shifts/reset-day", requireAdmin, (req, res) => {
    const { date, dayOfWeek } = req.body;
    if (!date || typeof dayOfWeek !== "number") {
      return res.status(400).json({ message: "date and dayOfWeek required" });
    }
    const dayShifts = storage.getShifts().filter(s => s.dayOfWeek === dayOfWeek);
    for (const s of dayShifts) {
      storage.updateShift(s.id, { activeStart: null, activeEnd: null, breakStart: null });
    }
    const pending = storage.getOvertimeLogs().filter(r => r.date === date && r.status === "pending");
    for (const r of pending) {
      storage.deleteOvertimeLog(r.id);
    }
    res.json({ ok: true });
  });

  app.patch("/api/shifts/:id", (req, res) => {
    const shiftId = Number(req.params.id);
    const existing = storage.getShifts().find((s) => s.id === shiftId);
    if (!existing) return res.status(404).json({ message: "Not found" });

    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);

    // Check: must be admin OR agent editing their own shift
    if (!admin && !sessionAgentId) {
      return res.status(401).json({ message: "Agent session required" });
    }
    if (!admin && sessionAgentId !== existing.agentId) {
      return res.status(403).json({ message: "You can only edit your own shift" });
    }

    const allowedForAgent = ["activeStart", "activeEnd", "breakStart"] as const;
    let payload: Record<string, unknown> = admin
      ? { ...req.body }
      : Object.fromEntries(
          Object.entries(req.body as Record<string, unknown>).filter(([k]) =>
            (allowedForAgent as readonly string[]).includes(k),
          ),
        );

    // BUG-01: Auto-clear breakStart if the new effective window crosses it
    const normEnd = normaliseEndUtcServer(existing.startUtc, existing.endUtc);
    if (existing.breakStart != null) {
      const effEnd   = (("activeEnd"   in payload ? payload.activeEnd   : existing.activeEnd)   ?? normEnd) as number;
      const effStart = (("activeStart" in payload ? payload.activeStart : existing.activeStart) ?? existing.startUtc) as number;
      const crossedByEnd   = effEnd   <= existing.breakStart;
      const crossedByStart = effStart >= existing.breakStart + 0.5;
      if (crossedByEnd || crossedByStart) {
        payload = { ...payload, breakStart: null };
      }
    }

    // BUG-02: Auto-create/update/delete pending OT record when manager extends past template end
    const dateStr = (admin && typeof req.body.date === "string") ? req.body.date : null;
    if (admin && dateStr) {
      const effEnd = (("activeEnd" in payload ? payload.activeEnd : existing.activeEnd) ?? normEnd) as number;
      const existingOT = storage.getOvertimeLogs().find(r =>
        r.fromShiftId === existing.id && r.date === dateStr &&
        r.origin === "manager-extended" && r.status === "pending"
      );
      if (effEnd > normEnd) {
        const otData = {
          overtimeHours: effEnd - normEnd,
          coverStartUtc: normEnd,
          coverEndUtc: effEnd,
          origin: "manager-extended" as const,
          fromShiftId: existing.id,
          dayOfWeek: existing.dayOfWeek,
          statusUpdatedAt: new Date().toISOString(),
        };
        if (existingOT) {
          storage.updateOvertimeLog(existingOT.id, otData);
        } else {
          storage.createOvertimeLog(existing.agentId, dateStr, { ...otData, status: "pending" });
        }
      } else if (existingOT) {
        storage.deleteOvertimeLog(existingOT.id);
      }
    }

    // Strip the date field before passing to updateShift (not a shift column)
    const { date: _date, ...shiftPayload } = payload as Record<string, unknown>;

    const shift = storage.updateShift(shiftId, shiftPayload);
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

  // Clear all overtime records — must be registered before /:id to avoid "all" being treated as an id
  app.delete("/api/overtime/all", requireAdmin, (_req, res) => {
    storage.clearAllOvertimeLogs();
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

  // Delete a single overtime record (undo a demo/test assignment)
  app.delete("/api/overtime/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const existing = storage.getOvertimeLogs().find(r => r.id === id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    storage.deleteOvertimeLog(id);
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
  app.post("/api/overtime/assign", (req, res) => {
    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);
    if (!admin && !sessionAgentId) {
      return res.status(403).json({ message: "Admin or agent session required" });
    }

    const { fromShiftId, toAgentId, hours, date, dayOfWeek, coverStartUtc, coverEndUtc } = req.body;
    if (!toAgentId || !date) {
      return res.status(400).json({ message: "toAgentId and date required" });
    }

    if (!admin && sessionAgentId && Number(toAgentId) !== sessionAgentId) {
      return res.status(403).json({ message: "Agents can only submit requests for themselves" });
    }

    const allAgents = storage.getAgents();
    const toAgent = allAgents.find(a => a.id === toAgentId);
    if (!toAgent) return res.status(404).json({ message: "Agent not found" });

    let sourceShiftId: number | null = null;
    let sourceAgentId: number | null = null;
    let sourceAgentName: string | null = null;
    let resolvedDayOfWeek: number | null = typeof dayOfWeek === "number" ? dayOfWeek : null;
    let slotStartUtc: number | null = null;
    let slotEndUtc: number | null = null;
    let origin: "claimed-from-agent" | "claimed-open-gap" = "claimed-open-gap";

    if (typeof fromShiftId === "number") {
      const fromShift = storage.getShifts().find(s => s.id === fromShiftId);
      if (!fromShift) return res.status(404).json({ message: "Source shift not found" });

      const fromAgent = allAgents.find(a => a.id === fromShift.agentId);
      if (!fromAgent) return res.status(404).json({ message: "Agent not found" });

      const normEnd = fromShift.endUtc <= fromShift.startUtc ? fromShift.endUtc + 24 : fromShift.endUtc;
      const curActiveEnd = fromShift.activeEnd ?? normEnd;
      if (typeof hours !== "number" || hours <= 0) {
        return res.status(400).json({ message: "hours required when assigning from a shift" });
      }

      sourceShiftId = fromShift.id;
      sourceAgentId = fromShift.agentId;
      sourceAgentName = fromAgent.name;
      resolvedDayOfWeek = resolvedDayOfWeek ?? fromShift.dayOfWeek;
      // Use explicit cover times if provided (e.g. start-shrink freed segment)
      if (typeof coverStartUtc === "number" && typeof coverEndUtc === "number" && coverEndUtc > coverStartUtc) {
        slotStartUtc = coverStartUtc;
        slotEndUtc = coverEndUtc;
      } else {
        slotStartUtc = curActiveEnd;
        slotEndUtc = curActiveEnd + hours;
      }
      origin = "claimed-from-agent";
    } else {
      if (typeof coverStartUtc !== "number" || typeof coverEndUtc !== "number") {
        return res.status(400).json({ message: "coverStartUtc and coverEndUtc required for open-gap assignment" });
      }
      if (coverEndUtc <= coverStartUtc) {
        return res.status(400).json({ message: "coverEndUtc must be greater than coverStartUtc" });
      }
      if (resolvedDayOfWeek == null) {
        return res.status(400).json({ message: "dayOfWeek required for open-gap assignment" });
      }

      slotStartUtc = coverStartUtc;
      slotEndUtc = coverEndUtc;
      origin = "claimed-open-gap";
    }

    const assignedHours = slotEndUtc - slotStartUtc;

    // Safeguard: agent cannot claim coverage that overlaps their own active shift hours
    if (!admin && sessionAgentId) {
      const claimingShifts = storage.getShifts().filter(
        s => s.agentId === toAgentId && s.dayOfWeek === resolvedDayOfWeek
      );
      for (const s of claimingShifts) {
        const sNormEnd = normaliseEndUtcServer(s.startUtc, s.endUtc);
        const effStart = s.activeStart ?? s.startUtc;
        const effEnd   = s.activeEnd   ?? sNormEnd;
        if (effStart < slotEndUtc && effEnd > slotStartUtc) {
          return res.status(409).json({ message: "Cannot claim coverage during your own active shift hours" });
        }
      }
    }

    const sameCoverageOpportunity = storage
      .getOvertimeLogs()
      .find((record) => {
        if (record.status !== "pending") return false;
        if (record.date !== date) return false;
        if (record.dayOfWeek !== resolvedDayOfWeek) return false;
        if (record.origin !== origin) return false;
        if (record.fromShiftId !== sourceShiftId) return false;
        if (record.coveredByAgentId !== sourceAgentId) return false;
        if (record.coverStartUtc !== slotStartUtc) return false;
        if (record.coverEndUtc !== slotEndUtc) return false;
        return true;
      });

    const nowIso = new Date().toISOString();

    if (sameCoverageOpportunity) {
      const existingPendingClaim = storage
        .getClaimsForOpportunity(sameCoverageOpportunity.id)
        .find((claim) => claim.agentId === toAgentId && claim.status === "pending");

      if (existingPendingClaim) {
        return res.status(409).json({
          message: "You already joined this line",
          overtimeLog: sameCoverageOpportunity,
          claim: existingPendingClaim,
        });
      }

      const joinedClaim = storage.createClaim({
        opportunityId: sameCoverageOpportunity.id,
        agentId: toAgentId,
        status: "pending",
        note: null,
        createdAt: nowIso,
      });

      storage.createAgentLog({
        agentId: toAgentId,
        date,
        type: "shift-claim",
        coverPct: null,
        coveredByAgentId: sourceAgentId,
        notes: null,
        createdAt: nowIso,
        actionType: "shift-claimed",
        description: sourceAgentName
          ? `${toAgent.name} joined line for ${assignedHours.toFixed(1)}h from ${sourceAgentName}'s ${date} shift.`
          : `${toAgent.name} joined line for ${assignedHours.toFixed(1)}h open-gap coverage on ${date}.`,
      });

      return res.json({ ok: true, reused: true, overtimeLog: sameCoverageOpportunity, claim: joinedClaim });
    }

    // Create a single pending opportunity for this coverage slot.
    const otLog = storage.createOvertimeLog(toAgentId, date, {
      overtimeHours: assignedHours,
      origin,
      coveredByAgentId: sourceAgentId,
      status: "pending",
      statusUpdatedAt: nowIso,
      fromShiftId: sourceShiftId,
      dayOfWeek: resolvedDayOfWeek,
      coverStartUtc: slotStartUtc,
      coverEndUtc: slotEndUtc,
    });

    // First requester becomes #1 in line for this opportunity.
    const firstClaim = storage.createClaim({
      opportunityId: otLog.id,
      agentId: toAgentId,
      status: "pending",
      note: null,
      createdAt: nowIso,
    });

    storage.createAgentLog({
      agentId: toAgentId,
      date,
      type: "shift-claim",
      coverPct: null,
      coveredByAgentId: sourceAgentId,
      notes: null,
      createdAt: nowIso,
      actionType: "shift-claimed",
      description: sourceAgentName
        ? `${toAgent.name} opened line for ${assignedHours.toFixed(1)}h from ${sourceAgentName}'s ${date} shift.`
        : `${toAgent.name} opened line for ${assignedHours.toFixed(1)}h open-gap coverage on ${date}.`,
    });

    res.json({ ok: true, overtimeLog: otLog, claim: firstClaim });
  });

  // --- Overtime Claims (multi-agent competing) ---

  // Get all claims for a specific overtime opportunity
  app.get("/api/overtime/:id/claims", (_req, res) => {
    const claims = storage.getClaimsForOpportunity(Number(_req.params.id));
    res.json(claims);
  });

  // Agent submits a claim for an overtime opportunity (requires agent session)
  app.post("/api/overtime/:id/claim", (req: Request & { agentId?: number }, res) => {
    // Accept either agent session or admin token
    const adminToken = readAdminHeaderToken(req);
    const isAdmin = ADMIN_TOKEN && adminToken === ADMIN_TOKEN;
    const agentId = isAdmin ? (req.body.agentId as number | undefined) : getAgentSession(req);

    if (!agentId) return res.status(401).json({ message: "Agent session or admin token required" });

    const opportunityId = Number(req.params.id);
    const opportunity = storage.getOvertimeLogs().find(r => r.id === opportunityId);
    if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });
    if (opportunity.status !== "pending") {
      return res.status(409).json({ message: "This line is no longer open" });
    }

    // Safeguard: agent cannot claim coverage that overlaps their own active shift hours
    if (!isAdmin && opportunity.coverStartUtc != null && opportunity.coverEndUtc != null && opportunity.dayOfWeek != null) {
      const claimingShifts = storage.getShifts().filter(
        s => s.agentId === agentId && s.dayOfWeek === opportunity.dayOfWeek
      );
      for (const s of claimingShifts) {
        const sNormEnd = normaliseEndUtcServer(s.startUtc, s.endUtc);
        const effStart = s.activeStart ?? s.startUtc;
        const effEnd   = s.activeEnd   ?? sNormEnd;
        if (effStart < opportunity.coverEndUtc && effEnd > opportunity.coverStartUtc) {
          return res.status(409).json({ message: "Cannot claim coverage during your own active shift hours" });
        }
      }
    }

    // Prevent duplicate pending claims from same agent for same opportunity
    const existing = storage.getClaimsForOpportunity(opportunityId)
      .find(c => c.agentId === agentId && c.status === "pending");
    if (existing) return res.status(409).json({ message: "You already have a pending claim for this opportunity" });

    const agent = storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const claim = storage.createClaim({
      opportunityId,
      agentId,
      status: "pending",
      note: typeof req.body.note === "string" ? req.body.note : null,
      createdAt: new Date().toISOString(),
    });

    storage.createAgentLog({
      agentId,
      date: opportunity.date,
      type: "shift-claim",
      coverPct: null,
      coveredByAgentId: opportunity.coveredByAgentId ?? null,
      notes: null,
      createdAt: new Date().toISOString(),
      actionType: "shift-claimed",
      description: `${agent.name} submitted a claim for the ${opportunity.date} overtime opportunity.`,
    });

    res.json(claim);
  });

  // Agent cancels (undo) their own pending claim
  app.delete("/api/overtime/:id/claim", (req: Request & { agentId?: number }, res) => {
    const adminToken = readAdminHeaderToken(req);
    const isAdmin = ADMIN_TOKEN && adminToken === ADMIN_TOKEN;
    const agentId = isAdmin ? (req.body.agentId as number | undefined) : getAgentSession(req);

    if (!agentId) return res.status(401).json({ message: "Agent session or admin token required" });

    const opportunityId = Number(req.params.id);
    const claims = storage.getClaimsForOpportunity(opportunityId);
    const ownClaim = claims.find(c => c.agentId === agentId && c.status === "pending");
    if (!ownClaim) return res.status(404).json({ message: "No pending claim found for this agent" });

    const cancelled = storage.cancelClaim(ownClaim.id, agentId);

    const agent = storage.getAgent(agentId);
    const opportunity = storage.getOvertimeLogs().find(r => r.id === opportunityId);
    if (agent && opportunity) {
      storage.createAgentLog({
        agentId,
        date: opportunity.date,
        type: "shift-claim-cancelled",
        coverPct: null,
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "shift-claimed",
        description: `${agent.name} cancelled their claim for the ${opportunity.date} overtime opportunity.`,
      });
    }

    res.json(cancelled);
  });

  // Manager approves a specific claim (and rejects all others for same opportunity)
  app.post("/api/overtime/:id/approve-claim/:claimId", requireAdmin, (req, res) => {
    const opportunityId = Number(req.params.id);
    const claimId = Number(req.params.claimId);

    const opportunity = storage.getOvertimeLogs().find(r => r.id === opportunityId);
    if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });

    const claim = storage.getClaimsForOpportunity(opportunityId).find(c => c.id === claimId);
    if (!claim) return res.status(404).json({ message: "Claim not found" });

    const approved = storage.approveClaimAndRejectOthers(claimId, opportunityId);

    // Approve the opportunity itself, assign ownership to approved agent
    storage.updateOvertimeLog(opportunityId, {
      agentId: claim.agentId,
      status: "approved",
      statusUpdatedAt: new Date().toISOString(),
    });

    const agent = storage.getAgent(claim.agentId);
    if (agent) {
      storage.upsertRecentAgentLog({
        agentId: claim.agentId,
        date: opportunity.date,
        type: "overtime-status",
        coverPct: null,
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "overtime-status-changed",
        description: `Manager approved ${agent.name}'s claim for the ${opportunity.date} overtime opportunity.`,
      });
    }

    res.json({ ok: true, approved, opportunityId });
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

  app.post("/api/agent-logs", (req, res) => {
    const { agentId, date, type, coverPct, coveredByAgentId, notes, actionType, description } = req.body;
    if (!agentId || !date || !type) {
      return res.status(400).json({ message: "agentId, date and type are required" });
    }

    const targetAgentId = Number(agentId);
    if (!Number.isFinite(targetAgentId)) {
      return res.status(400).json({ message: "Invalid agentId" });
    }

    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);
    if (!admin && sessionAgentId !== targetAgentId) {
      return res.status(403).json({ message: "You can only write logs for your own agent session" });
    }

    const log = storage.upsertRecentAgentLog({
      agentId: targetAgentId,
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

  app.delete("/api/agent-logs/:id", requireAdmin, (req, res) => {
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
