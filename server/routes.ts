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
  { dayRange: [1,5], startUtc: 0, endUtc: 8 },   // A1 midnight-8am
  { dayRange: [1,5], startUtc: 2, endUtc: 10 },   // A2 2am-10am
  { dayRange: [1,5], startUtc: 4, endUtc: 12 },   // A3 4am-noon
  { dayRange: [1,5], startUtc: 6, endUtc: 14 },   // A4 6am-2pm
  { dayRange: [1,5], startUtc: 8, endUtc: 16 },   // A5 8am-4pm
  { dayRange: [1,5], startUtc: 10, endUtc: 18 },  // A6 10am-6pm
  { dayRange: [1,5], startUtc: 12, endUtc: 20 },  // A7 noon-8pm
  { dayRange: [1,5], startUtc: 14, endUtc: 22 },  // A8 2pm-10pm
  { dayRange: [1,5], startUtc: 16, endUtc: 24 },  // A9 4pm-midnight
  { dayRange: [1,5], startUtc: 18, endUtc: 26 },  // A10 6pm-2am
  { dayRange: [1,5], startUtc: 20, endUtc: 28 },  // A11 8pm-4am
  { dayRange: [1,5], startUtc: 22, endUtc: 30 },  // A12 10pm-6am
  { dayRange: [1,5], startUtc: 1, endUtc: 9 },    // A13 1am-9am
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Los_Angeles", "America/Sao_Paulo",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Singapore",
  "Australia/Sydney", "Pacific/Auckland", "Africa/Nairobi", "Asia/Dubai", "Asia/Kolkata"
];

async function seedDefaultData() {
  const existing = storage.getAgents();
  if (existing.length > 0) return;

  // Create 13 agents
  const createdAgents = [];
  for (let i = 1; i <= 13; i++) {
    const agent = storage.createAgent({
      name: `Agent ${i}`,
      color: DEFAULT_COLORS[(i - 1) % DEFAULT_COLORS.length],
      avatarUrl: null,
      timezone: TIMEZONES[(i - 1) % TIMEZONES.length],
      role: "Support Agent",
    });
    createdAgents.push(agent);
  }

  // Create default shifts for each agent (Mon-Fri)
  for (let i = 0; i < createdAgents.length; i++) {
    const agent = createdAgents[i];
    const shiftTemplate = DEFAULT_SHIFTS[i];
    for (let day = shiftTemplate.dayRange[0]; day <= shiftTemplate.dayRange[1]; day++) {
      const rawStart = shiftTemplate.startUtc;
      const rawEnd = shiftTemplate.endUtc;
      // Normalize to 0-24 window: keep within bounds
      const normStart = rawStart % 24;
      const normEnd = Math.min(24, rawEnd > 24 ? rawEnd - 24 + normStart : rawEnd);
      storage.upsertShift({
        agentId: agent.id,
        dayOfWeek: day,
        startUtc: normStart,
        endUtc: normEnd > normStart ? normEnd : Math.min(24, normStart + 8),
        activeStart: null,
        activeEnd: null,
      });
    }
  }
}

function runMigrations() {
  // Safe migration: add break_start if not present
  try {
    const cols = db.run("ALTER TABLE shifts ADD COLUMN break_start REAL");
  } catch {
    // Column already exists — fine
  }
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
