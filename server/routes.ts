import type { Express } from "express";
import { createServer, type Server } from "http";
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

// Default shifts: staggered around the clock for good coverage
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
  { dayRange: [1,5], startUtc: 18, endUtc: 26 },
  { dayRange: [1,5], startUtc: 20, endUtc: 28 },
  { dayRange: [1,5], startUtc: 22, endUtc: 30 },
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
    for (let day = shiftTemplate.dayRange[0]; day <= shiftTemplate.dayRange[1]; day++) {
      storage.upsertShift({
        agentId: agent.id,
        dayOfWeek: day,
        startUtc: shiftTemplate.startUtc,
        endUtc: shiftTemplate.endUtc,
        activeStart: null,
        activeEnd: null,
        breakStart: null,
      });
    }
  }
}

function runMigrations() {
  // Safe migrations: each wrapped in try/catch — column already existing is fine
  const safeAlter = (sql: string) => { try { db.run(sql); } catch { /* already exists */ } };
  safeAlter("ALTER TABLE shifts ADD COLUMN break_start REAL");
  safeAlter("ALTER TABLE agents ADD COLUMN off_weekend INTEGER NOT NULL DEFAULT 1");
  safeAlter("ALTER TABLE agents ADD COLUMN off_cycle_start TEXT");
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
  // POST /api/agents/:id/apply-week  { startUtc: number, endUtc: number }
  // Uses the agent's current offWeekend setting to decide which days to skip.
  app.post("/api/agents/:id/apply-week", (req, res) => {
    const agentId = Number(req.params.id);
    const agent = storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const { startUtc, endUtc } = req.body;
    if (typeof startUtc !== "number" || typeof endUtc !== "number") {
      return res.status(400).json({ message: "startUtc and endUtc required" });
    }
    // Normalise overnight: if endUtc <= startUtc, treat end as next-day (add 24)
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
}
