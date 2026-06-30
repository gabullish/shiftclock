import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { storage } from "./storage";
import { client } from "./db";
import { insertAgentSchema, insertShiftSchema } from "@shared/schema";

type NormalizedBackup = {
  agents: Array<Record<string, unknown> & { id?: number; shifts: Array<Record<string, unknown>>; historicalShifts?: Array<Record<string, unknown>> }>;
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

/** Timing-safe token comparison — prevents timing attacks on admin token */
function safeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // Still run comparison to avoid length-based timing leak
      timingSafeEqual(ba, Buffer.alloc(ba.length));
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function isAdminRequest(req: Request): boolean {
  if (!ADMIN_TOKEN) return false;
  return safeTokenEqual(readAdminHeaderToken(req), ADMIN_TOKEN);
}

/** Middleware: reject non-admin requests to mutating endpoints */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ message: "Server misconfigured: ADMIN_TOKEN is not set" });
  }
  if (safeTokenEqual(readAdminHeaderToken(req), ADMIN_TOKEN)) return next();
  res.status(403).json({ message: "Admin access required" });
}

/** Middleware: allow either an authenticated agent session or an admin token */
function requireAgentOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdminRequest(req) || getAgentSession(req)) return next();
  res.status(401).json({ message: "Sign in as agent or manager" });
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
  const existing = await storage.getAgents();
  if (existing.length > 0) return;

  const createdAgents = [];
  for (let i = 1; i <= 13; i++) {
    const agent = await storage.createAgent({
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
      await storage.upsertShift({
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

    // Extract and validate historicalShifts (optional)
    const historicalShifts = Array.isArray(row.historicalShifts) ? row.historicalShifts : [];
    const cleanedHistoricalShifts = historicalShifts
      .filter((h) => {
        const hs = h as Record<string, unknown>;
        return isIsoDate(hs.date) && typeof hs.offWeekend === "number";
      })
      .map((h) => {
        const hs = h as Record<string, unknown>;
        return {
          date: hs.date as string,
          offWeekend: Number(hs.offWeekend),
          note: typeof hs.note === "string" ? hs.note : null,
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
      historicalShifts: cleanedHistoricalShifts,
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

// Rate limiter for authentication endpoints — max 20 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please wait 15 minutes." },
});

// ─── SSE live-push ────────────────────────────────────────────────────────────
// Clients subscribe to /api/events and receive lightweight invalidation signals.
// No data is sent — clients re-fetch via their existing auth'd query layer.
const sseClients = new Set<Response>();

function getNextMondayUtc(): string {
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 0=Sun
  const daysToNextMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysToNextMonday));
  return d.toISOString().slice(0, 10);
}

function broadcast(keys: string[]) {
  const payload = `data: ${JSON.stringify({ invalidate: keys })}\n\n`;
  for (const client of Array.from(sseClients)) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// Auto-manage scheduled breaks:
//   • Auto-START: breakStart has arrived and agent isn't on break yet
//   • Auto-END:   break window (breakStart + 30 min) has elapsed → log completion
// Runs both on every /api/agents poll AND on a server-side interval, so breaks
// advance and log even when no client is open to trigger a poll. Returns true if
// any agent's break state changed (so callers can broadcast an invalidation).
const BREAK_DURATION_H = 0.5; // standard 30-minute break
async function sweepBreaks(): Promise<boolean> {
  const now  = new Date();
  const dow  = now.getUTCDay();
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  const allShifts = await storage.getShifts();
  let changed = false;

  const fmtUTC = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCHours().toString().padStart(2,"0")}:${d.getUTCMinutes().toString().padStart(2,"0")}`;
  };

  for (const agent of await storage.getAgents()) {
    const todayShift = allShifts.find(
      s => s.agentId === agent.id && s.dayOfWeek === dow && s.breakStart != null,
    );

    if (agent.breakActiveAt) {
      // End break after BREAK_DURATION_H has elapsed since it started. Using
      // absolute elapsed time (not utcH comparison) makes this safe across
      // midnight wraps when breakStart + duration would exceed 24.
      const startMs  = Date.parse(agent.breakActiveAt);
      const elapsedH = (now.getTime() - startMs) / 3_600_000;
      if (elapsedH >= BREAK_DURATION_H) {
        const durationMins = Math.round(elapsedH * 60);
        const description = `${agent.name} was on break · ${durationMins} min  (${fmtUTC(startMs)} – ${fmtUTC(now.getTime())} UTC)`;
        await storage.endLiveBreak(agent.id);
        await storage.createAgentLog({
          agentId: agent.id,
          date: now.toISOString().slice(0, 10),
          type: "break",
          coveredByAgentId: null,
          notes: null,
          createdAt: now.toISOString(),
          actionType: "break-completed",
          description,
        });
        changed = true;
      }
    } else if (todayShift?.breakStart != null) {
      // Auto-start: only trigger inside the [breakStart, breakStart + 30 min]
      // window. Outside that window, the break is considered skipped.
      if (utcH >= todayShift.breakStart && utcH < todayShift.breakStart + BREAK_DURATION_H) {
        await storage.startLiveBreak(agent.id);
        changed = true;
      }
    }
  }
  return changed;
}
// ──────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express) {
  if (!ADMIN_TOKEN) {
    console.warn("[routes] ADMIN_TOKEN is not configured. Mutating admin routes will return 500.");
  }
  if (!AGENT_PASSWORD) {
    console.warn("[routes] AGENT_PASSWORD is not configured. Agent mode will be disabled.");
  }
  await seedDefaultData();

  // Server-side break ticker — advances scheduled breaks (auto start/end + logging)
  // every 30s regardless of whether any client is polling, so break history stays
  // accurate even with nobody watching. Broadcasts only when state actually changed.
  const breakTicker = setInterval(() => {
    sweepBreaks()
      .then(changed => { if (changed) broadcast(["agents", "agent-logs"]); })
      .catch(err => console.error("[break-ticker] sweep failed:", err));
  }, 30_000);
  if (typeof breakTicker.unref === "function") breakTicker.unref();

  // SSE endpoint — no auth needed (signals only, no data)
  app.get("/api/events", (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("data: connected\n\n");
    sseClients.add(res);
    // Heartbeat every 25 s to keep the connection alive through Render's idle timeout
    const heartbeat = setInterval(() => {
      try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); sseClients.delete(res); }
    }, 25_000);
    _req.on("close", () => { sseClients.delete(res); clearInterval(heartbeat); });
  });

  // --- Agent session auth ---
  app.post("/api/auth/agent-session", authLimiter, async (req, res) => {
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
    const agent = await storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    const token = makeAgentToken(agentId);
    return res.json({ token, agentId, agentName: agent.name });
  });

  app.get("/api/auth/agent-session", async (req, res) => {
    const token = readAgentSessionToken(req);
    if (!token) return res.status(401).json({ message: "No session token" });
    const result = verifyAgentToken(token);
    if (!result) return res.status(401).json({ message: "Invalid or expired session" });
    const agent = await storage.getAgent(result.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    return res.json({ agentId: result.agentId, agentName: agent.name });
  });

  app.get("/api/auth/agent-password-configured", (_req, res) => {
    res.json({ configured: Boolean(AGENT_PASSWORD) });
  });

  // --- Admin verify ---
  // Rate-limited like the agent-session route — the manager password is the
  // single highest-value secret, so cap brute-force attempts per IP.
  app.get("/api/admin/verify", authLimiter, (req, res) => {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ message: "Server misconfigured: ADMIN_TOKEN is not set" });
    }
    if (!safeTokenEqual(readAdminHeaderToken(req), ADMIN_TOKEN)) {
      return res.status(401).json({ message: "Invalid admin token" });
    }
    return res.json({ ok: true });
  });

  app.get("/api/agents", async (_req, res) => {
    // Advance scheduled breaks lazily on read (the server-side ticker below also
    // runs this so state advances with no client open).
    await sweepBreaks();
    res.json(await storage.getAgents());
  });

  app.post("/api/agents", requireAdmin, async (req, res) => {
    const result = insertAgentSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.issues[0]?.message ?? "Invalid agent data" });
    const agentData = { ...result.data, offCycleStart: result.data.offCycleStart ?? getNextMondayUtc() };
    const agent = await storage.createAgent(agentData);
    broadcast(["agents"]);
    res.json(agent);
  });

  app.patch("/api/agents/:id", async (req, res) => {
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

    const agent = await storage.updateAgent(targetId, payload);
    if (!agent) return res.status(404).json({ message: "Not found" });
    broadcast(["agents"]);
    res.json(agent);
  });

  app.delete("/api/agents/:id", requireAdmin, async (req, res) => {
    await storage.deleteAgent(Number(req.params.id));
    broadcast(["agents", "shifts"]);
    res.json({ ok: true });
  });

  // --- Sprite template download ---
  app.get("/api/sprites/template", (_req, res) => {
    res.redirect("/sprite-template.svg");
  });

  // --- Custom sprite upload ---
  app.post("/api/agents/:id/sprite", async (req, res) => {
    const targetId = Number(req.params.id);
    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);

    if (!admin && sessionAgentId !== targetId) {
      return res.status(403).json({ message: "You can only upload your own sprite" });
    }

    const { spriteData } = req.body as { spriteData?: string };
    if (!spriteData) {
      return res.status(400).json({ message: "spriteData required" });
    }

    if (!spriteData.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ message: "Must be a PNG image" });
    }

    if (spriteData.length > 2_800_000) {
      return res.status(413).json({ message: "Image too large (max ~2MB)" });
    }

    const agent = await storage.updateAgent(targetId, { customSprite: spriteData });
    if (!agent) return res.status(404).json({ message: "Not found" });
    broadcast(["agents"]);
    res.json(agent);
  });

  // --- Clear custom sprite ---
  app.delete("/api/agents/:id/sprite", async (req, res) => {
    const targetId = Number(req.params.id);
    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);

    if (!admin && sessionAgentId !== targetId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const agent = await storage.updateAgent(targetId, { customSprite: null });
    if (!agent) return res.status(404).json({ message: "Not found" });
    broadcast(["agents"]);
    res.json(agent);
  });

  // ── World background image ──────────────────────────────────────────────────
  app.get("/api/world/background", async (req, res) => {
    try {
      const result = await client.execute("SELECT value FROM settings WHERE key = 'world_background'");
      const row = result.rows[0];
      if (!row) return res.status(404).json({ message: "No background set" });
      const value = row.value as string;
      // ETag lets clients skip re-downloading the (large) blob when unchanged.
      const etag = `"${createHash("sha1").update(value).digest("hex")}"`;
      res.set("Cache-Control", "private, max-age=60");
      res.set("ETag", etag);
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.json({ imageData: value });
    } catch {
      res.status(404).json({ message: "No background set" });
    }
  });

  app.post("/api/world/background", requireAdmin, async (req, res) => {
    const { imageData } = req.body as { imageData?: string };
    if (!imageData || !imageData.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ message: "PNG data URL required" });
    }
    if (imageData.length > 8_000_000) {
      return res.status(413).json({ message: "Image too large (max ~6MB)" });
    }
    await client.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('world_background', ?)", args: [imageData] });
    broadcast(["world/background"]);
    res.json({ ok: true });
  });

  app.delete("/api/world/background", requireAdmin, async (_req, res) => {
    await client.execute("DELETE FROM settings WHERE key = 'world_background'");
    broadcast(["world/background"]);
    res.json({ ok: true });
  });

  // --- Live break state ---
  app.post("/api/agents/:id/break/start", async (req, res) => {
    const id = Number(req.params.id);
    if (!isAdminRequest(req) && getAgentSession(req) !== id) {
      return res.status(403).json({ message: "You can only manage your own break" });
    }
    const agent = await storage.startLiveBreak(id);
    if (!agent) return res.status(404).json({ message: "Not found" });
    // No log on start — the live toast + audio handles teammate communication.
    // The completed break entry (logged on /break/end) keeps the log clean.
    broadcast(["agents"]);
    res.json(agent);
  });

  app.post("/api/agents/:id/break/end", async (req, res) => {
    const id = Number(req.params.id);
    if (!isAdminRequest(req) && getAgentSession(req) !== id) {
      return res.status(403).json({ message: "You can only manage your own break" });
    }
    // Capture start time before clearing it
    const breakStartedAt = (await storage.getAgents()).find(a => a.id === id)?.breakActiveAt ?? null;
    const agent = await storage.endLiveBreak(id);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const date = new Date().toISOString().slice(0, 10);

    // Build a rich completion log with actual duration and time range
    const fmtUtcHHMM = (ts: number) => {
      const d = new Date(ts);
      return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
    };
    const startedMs = breakStartedAt ? Date.parse(breakStartedAt) : null;
    const endedMs   = Date.now();
    const durationMins = startedMs ? Math.round((endedMs - startedMs) / 60000) : null;
    const timeRange = startedMs && durationMins != null
      ? `  (${fmtUtcHHMM(startedMs)} – ${fmtUtcHHMM(endedMs)} UTC)`
      : "";
    const description = durationMins != null
      ? `${agent.name} was on break · ${durationMins} min${timeRange}`
      : `${agent.name} returned from break.`;

    await storage.createAgentLog({
      agentId: id, date, type: "break", coveredByAgentId: null,
      notes: null, createdAt: new Date().toISOString(),
      actionType: "break-completed",
      description,
    });
    broadcast(["agents", "agent-logs"]);
    res.json(agent);
  });

  // --- Apply week template ---
  app.post("/api/agents/:id/apply-week", requireAdmin, async (req, res) => {
    const agentId = Number(req.params.id);
    const agent = await storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Not found" });
    const { startUtc, endUtc } = req.body;
    if (typeof startUtc !== "number" || typeof endUtc !== "number") {
      return res.status(400).json({ message: "startUtc and endUtc required" });
    }
    // Normalize overnight: if end <= start, add 24 to represent next-day end
    const normEnd = endUtc <= startUtc ? endUtc + 24 : endUtc;
    const updatedShifts = await storage.applyWeekTemplate(agentId, startUtc, normEnd, agent.offWeekend ?? 1);
    broadcast(["shifts"]);
    res.json(updatedShifts);
  });

  // --- Shifts ---
  app.get("/api/shifts", async (_req, res) => {
    res.json(await storage.getShifts());
  });

  app.post("/api/shifts", requireAdmin, async (req, res) => {
    const result = insertShiftSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.issues[0]?.message ?? "Invalid shift data" });
    const { startUtc, endUtc } = result.data;
    // Prevent 0-hour shifts — endUtc === startUtc means zero duration
    const normEnd = endUtc < startUtc ? endUtc + 24 : endUtc;
    if (normEnd - startUtc < 0.5) {
      return res.status(400).json({ message: "Shift duration must be at least 0.5 hours" });
    }
    const shift = await storage.upsertShift(result.data);
    broadcast(["shifts"]);
    res.json(shift);
  });

  // BUG-03: Reset all lever adjustments + pending OT for a given day
  app.post("/api/shifts/reset-day", requireAdmin, async (req, res) => {
    const { date, dayOfWeek } = req.body;
    if (!date || typeof dayOfWeek !== "number") {
      return res.status(400).json({ message: "date and dayOfWeek required" });
    }
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ message: "dayOfWeek must be 0–6" });
    }
    const dayShifts = (await storage.getShifts()).filter(s => s.dayOfWeek === dayOfWeek);
    for (const s of dayShifts) {
      await storage.updateShift(s.id, { activeStart: null, activeEnd: null, breakStart: null });
    }
    const pending = (await storage.getOvertimeLogs()).filter(r => r.date === date && r.status === "pending");
    for (const r of pending) {
      await storage.deleteOvertimeLog(r.id);
    }
    broadcast(["shifts", "overtime"]);
    res.json({ ok: true });
  });

  app.patch("/api/shifts/:id", async (req, res) => {
    const shiftId = Number(req.params.id);
    const existing = (await storage.getShifts()).find((s) => s.id === shiftId);
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

    // Bounds validation: reject lever values outside safe range
    if ("activeStart" in payload || "activeEnd" in payload) {
      const effStart = ("activeStart" in payload ? payload.activeStart : existing.activeStart ?? existing.startUtc) as number;
      const effEnd   = ("activeEnd"   in payload ? payload.activeEnd   : existing.activeEnd   ?? normaliseEndUtcServer(existing.startUtc, existing.endUtc)) as number;
      if (typeof effStart !== "number" || effStart < -8 || effStart >= 48) {
        return res.status(400).json({ message: "activeStart out of range [-8, 48)" });
      }
      if (typeof effEnd !== "number" || effEnd <= 0 || effEnd > 48) {
        return res.status(400).json({ message: "activeEnd out of range (0, 48]" });
      }
      if (effEnd < effStart + 0.5) {
        return res.status(400).json({ message: "activeEnd must be at least 0.5h after activeStart" });
      }
      // OT cap: activeEnd cannot exceed base scheduled end + 2h
      const normBaseEnd = normaliseEndUtcServer(existing.startUtc, existing.endUtc);
      if (effEnd > normBaseEnd + 2) {
        return res.status(400).json({
          message: `Cannot extend more than 2h past scheduled end (max ${normBaseEnd + 2})`,
        });
      }
      // Combined duration cap: total active window ≤ baseDuration + 2h
      const baseDuration = normBaseEnd - existing.startUtc;
      if (effEnd - effStart > baseDuration + 2) {
        return res.status(400).json({
          message: `Total active window cannot exceed base duration + 2h (max ${baseDuration + 2}h)`,
        });
      }
    }

    // Validate breakStart is within shift window when set directly
    if ("breakStart" in payload && payload.breakStart != null) {
      const bs = Number(payload.breakStart);
      if (!Number.isFinite(bs) || bs < 0 || bs >= 48) {
        return res.status(400).json({ message: "breakStart out of range [0, 48)" });
      }
      const shiftStart = existing.startUtc;
      const shiftEnd   = normaliseEndUtcServer(existing.startUtc, existing.endUtc);
      const bsNorm = bs < shiftStart ? bs + 24 : bs;
      if (bsNorm < shiftStart + 1.0 || bsNorm + 0.5 > shiftEnd - 1.0) {
        return res.status(400).json({ message: "breakStart must be at least 1h from shift start/end with 30m duration" });
      }
    }

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
      const existingOT = (await storage.getOvertimeLogs()).find(r =>
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
          await storage.updateOvertimeLog(existingOT.id, otData);
        } else {
          await storage.createOvertimeLog(existing.agentId, dateStr, { ...otData, status: "pending" });
        }
      } else if (existingOT) {
        await storage.deleteOvertimeLog(existingOT.id);
      }
    }

    // Strip the date field before passing to updateShift (not a shift column)
    const { date: _date, ...shiftPayload } = payload as Record<string, unknown>;

    const shift = await storage.updateShift(shiftId, shiftPayload);
    if (!shift) return res.status(404).json({ message: "Not found" });
    broadcast(["shifts", "overtime"]);
    res.json(shift);
  });

  app.delete("/api/shifts/:id", requireAdmin, async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    broadcast(["shifts"]);
    res.json({ ok: true });
  });

  // --- Overtime ---
  app.get("/api/overtime", async (_req, res) => {
    res.json(await storage.getOvertimeLogs());
  });

  const overtimeCreateSchema = z.object({
    agentId: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  }).passthrough();

  app.post("/api/overtime", requireAdmin, async (req, res) => {
    const result = overtimeCreateSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.issues[0]?.message ?? "Invalid overtime data" });
    const { agentId, date, ...rest } = result.data;
    const log = await storage.createOvertimeLog(agentId, date, rest);
    broadcast(["overtime"]);
    res.json(log);
  });

  // Update overtime record status (approve / deny / paid)
  app.patch("/api/overtime/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!status || !["pending", "approved", "denied", "paid"].includes(status)) {
      return res.status(400).json({ message: "Valid status required: pending|approved|denied|paid" });
    }
    // Get current record to know old status before updating
    const existing = (await storage.getOvertimeLogs()).find(r => r.id === id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Reconcile any pending claims so the claim queue can never desync from the
    // opportunity's status. Approving/paying an opportunity that still has people
    // in line implicitly awards it: honor the claim matching the record's agent,
    // else the first in line; reject the rest and credit that agent. Denying
    // clears the queue. Without this, a manager using the plain status dropdown
    // would leave claims stuck "pending" forever and credit the wrong agent.
    const pendingClaims = (await storage.getClaimsForOpportunity(id)).filter(c => c.status === "pending");
    let effectiveAgentId = existing.agentId;
    if ((status === "approved" || status === "paid") && pendingClaims.length > 0) {
      const chosen =
        pendingClaims.find(c => c.agentId === existing.agentId) ??
        [...pendingClaims].sort((a, b) => a.claimOrder - b.claimOrder)[0];
      await storage.approveClaimAndRejectOthers(chosen.id, id);
      effectiveAgentId = chosen.agentId;
    } else if (status === "denied" && pendingClaims.length > 0) {
      for (const c of pendingClaims) {
        await storage.cancelClaim(c.id, c.agentId).catch(() => {});
      }
    }

    const updated = await storage.updateOvertimeLog(id, {
      status,
      agentId: effectiveAgentId,
      statusUpdatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ message: "Not found" });

    // When a claimed-from-agent record is approved (and wasn't already), no shift extension needed.
    // The coverage slot is stored in coverStartUtc/coverEndUtc and rendered as a separate bar.
    // (Previously this extended the receiver's activeEnd — that was wrong.)

    // When reverting from approved (to pending/denied), no shift changes needed.
    // Coverage is rendered from the OT record's status, not from shift activeEnd.

    // Log the status change (deduped — rapid clicks collapse into one entry)
    const allAgents = await storage.getAgents();
    const agent = allAgents.find(a => a.id === updated.agentId);
    if (agent) {
      await storage.upsertRecentAgentLog({
        agentId: updated.agentId,
        date: updated.date,
        type: "overtime-status",
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "overtime-status-changed",
        description: `Manager ${status} ${agent.name}'s overtime for ${updated.date} shift (${updated.overtimeHours.toFixed(1)}h).`,
      });
    }
    broadcast(["overtime", "agent-logs"]);
    res.json(updated);
  });

  // Clear all overtime records — must be registered before /:id to avoid "all" being treated as an id
  app.delete("/api/overtime/all", requireAdmin, async (_req, res) => {
    await storage.clearAllOvertimeLogs();
    broadcast(["overtime", "overtime-claims"]);
    res.json({ ok: true });
  });

  // Bulk delete overtime records by id list
  app.delete("/api/overtime", requireAdmin, async (req, res) => {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.some(i => typeof i !== "number")) {
      return res.status(400).json({ message: "ids must be an array of numbers" });
    }
    await storage.bulkDeleteOvertimeLogs(ids as number[]);
    broadcast(["overtime", "overtime-claims"]);
    res.json({ ok: true });
  });

  // Delete a single overtime record (undo a demo/test assignment)
  app.delete("/api/overtime/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const existing = (await storage.getOvertimeLogs()).find(r => r.id === id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    await storage.deleteOvertimeLog(id);
    broadcast(["overtime", "overtime-claims"]);
    res.json({ ok: true });
  });

  // Replace overtime records from uploaded JSON
  app.post("/api/overtime/import", requireAdmin, async (req, res) => {
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

    await storage.replaceOvertimeLogs(cleaned as any);
    res.json({ ok: true, count: cleaned.length });
  });

  // Assign freed overtime from one agent to another
  app.post("/api/overtime/assign", async (req, res) => {
    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);
    if (!admin && !sessionAgentId) {
      return res.status(403).json({ message: "Admin or agent session required" });
    }

    const { fromShiftId, hours, date, dayOfWeek, coverStartUtc, coverEndUtc } = req.body;
    const toAgentId = Number(req.body.toAgentId);
    if (!toAgentId || !date) {
      return res.status(400).json({ message: "toAgentId and date required" });
    }
    if (!Number.isFinite(toAgentId) || toAgentId <= 0) {
      return res.status(400).json({ message: "Invalid toAgentId" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "date must be YYYY-MM-DD" });
    }
    if (typeof dayOfWeek === "number" && (dayOfWeek < 0 || dayOfWeek > 6)) {
      return res.status(400).json({ message: "dayOfWeek must be 0–6" });
    }

    if (!admin && sessionAgentId && Number(toAgentId) !== sessionAgentId) {
      return res.status(403).json({ message: "Agents can only submit requests for themselves" });
    }

    const allAgents = await storage.getAgents();
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
      const fromShift = (await storage.getShifts()).find(s => s.id === fromShiftId);
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

    // Retroactive path: the slot is in the PAST, so this records coverage that
    // already happened rather than opening a claim line. No approval queue, no
    // competition — write it straight as approved and log who recorded it.
    // Allowed for agents and admins alike (the log captures accountability).
    if (req.body.retroactive === true) {
      const retroIso = new Date().toISOString();
      const otLog = await storage.createOvertimeLog(toAgentId, date, {
        overtimeHours: assignedHours,
        coverStartUtc: slotStartUtc,
        coverEndUtc: slotEndUtc,
        origin,
        fromShiftId: sourceShiftId,
        dayOfWeek: resolvedDayOfWeek,
        coveredByAgentId: sourceAgentId,
        status: "approved",
        statusUpdatedAt: retroIso,
      });
      await storage.createAgentLog({
        agentId: toAgentId,
        date,
        type: "shift-claim",
        coveredByAgentId: sourceAgentId,
        notes: null,
        createdAt: retroIso,
        actionType: "retroactive-coverage",
        description: sourceAgentName
          ? `${toAgent.name} logged retroactive coverage of ${assignedHours.toFixed(1)}h from ${sourceAgentName}'s ${date} shift.`
          : `${toAgent.name} logged retroactive coverage of ${assignedHours.toFixed(1)}h open-gap on ${date}.`,
      });
      broadcast(["overtime", "agent-logs"]);
      return res.json({ ok: true, retroactive: true, overtimeLog: otLog });
    }

    // Safeguard: agent cannot claim coverage that overlaps their own active shift hours
    if (!admin && sessionAgentId) {
      const claimingShifts = (await storage.getShifts()).filter(
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

    const nowIso = new Date().toISOString();

    // findOrCreateOpportunity is atomic — prevents duplicate opportunity rows
    // when two agents submit for the same slot simultaneously (P0 race fix)
    const { opportunity: sameCoverageOpportunity, isNew: isNewOpportunity } =
      await storage.findOrCreateOpportunity({
        date,
        dayOfWeek: resolvedDayOfWeek,
        origin,
        fromShiftId: sourceShiftId,
        coveredByAgentId: sourceAgentId,
        coverStartUtc: slotStartUtc,
        coverEndUtc: slotEndUtc,
        overtimeHours: assignedHours,
        toAgentId,
        nowIso,
      });

    if (!isNewOpportunity) {
      const existingPendingClaim = (await storage.getClaimsForOpportunity(sameCoverageOpportunity.id))
        .find((claim) => claim.agentId === toAgentId && claim.status === "pending");

      if (existingPendingClaim) {
        return res.status(409).json({
          message: "You already joined this line",
          overtimeLog: sameCoverageOpportunity,
          claim: existingPendingClaim,
        });
      }

      const joinedClaim = await storage.createClaim({
        opportunityId: sameCoverageOpportunity.id,
        agentId: toAgentId,
        status: "pending",
        note: null,
        createdAt: nowIso,
      });

      await storage.createAgentLog({
        agentId: toAgentId,
        date,
        type: "shift-claim",
        coveredByAgentId: sourceAgentId,
        notes: null,
        createdAt: nowIso,
        actionType: "shift-claimed",
        description: sourceAgentName
          ? `${toAgent.name} joined line for ${assignedHours.toFixed(1)}h from ${sourceAgentName}'s ${date} shift.`
          : `${toAgent.name} joined line for ${assignedHours.toFixed(1)}h open-gap coverage on ${date}.`,
      });

      broadcast(["overtime", "overtime-claims", "agent-logs"]);
    return res.json({ ok: true, reused: true, overtimeLog: sameCoverageOpportunity, claim: joinedClaim });
    }

    // New opportunity — first requester is already #1 in line (created atomically in findOrCreateOpportunity)
    const otLog = sameCoverageOpportunity;
    const firstClaim = (await storage.getClaimsForOpportunity(otLog.id))[0];

    await storage.createAgentLog({
      agentId: toAgentId,
      date,
      type: "shift-claim",
      coveredByAgentId: sourceAgentId,
      notes: null,
      createdAt: nowIso,
      actionType: "shift-claimed",
      description: sourceAgentName
        ? `${toAgent.name} opened line for ${assignedHours.toFixed(1)}h from ${sourceAgentName}'s ${date} shift.`
        : `${toAgent.name} opened line for ${assignedHours.toFixed(1)}h open-gap coverage on ${date}.`,
    });

    broadcast(["overtime", "overtime-claims", "agent-logs"]);
    res.json({ ok: true, overtimeLog: otLog, claim: firstClaim });
  });

  // --- Overtime Claims (multi-agent competing) ---

  // Get all claims for a specific overtime opportunity
  app.get("/api/overtime/:id/claims", async (_req, res) => {
    const claims = await storage.getClaimsForOpportunity(Number(_req.params.id));
    res.json(claims);
  });

  // Agent submits a claim for an overtime opportunity (requires agent session)
  app.post("/api/overtime/:id/claim", async (req: Request & { agentId?: number }, res) => {
    // Accept either agent session or admin token
    const adminToken = readAdminHeaderToken(req);
    const isAdmin = ADMIN_TOKEN && adminToken === ADMIN_TOKEN;
    const agentId = isAdmin ? (req.body.agentId as number | undefined) : getAgentSession(req);

    if (!agentId) return res.status(401).json({ message: "Agent session or admin token required" });

    const opportunityId = Number(req.params.id);
    const opportunity = (await storage.getOvertimeLogs()).find(r => r.id === opportunityId);
    if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });
    if (opportunity.status !== "pending") {
      return res.status(409).json({ message: "This line is no longer open" });
    }

    // Safeguard: agent cannot claim coverage that overlaps their own active shift hours.
    // Handles overnight slots where coverEndUtc > 24 by also checking the next calendar day.
    if (!isAdmin && opportunity.coverStartUtc != null && opportunity.coverEndUtc != null && opportunity.dayOfWeek != null) {
      const coverStart = opportunity.coverStartUtc;
      const coverEnd   = opportunity.coverEndUtc;
      const dow        = opportunity.dayOfWeek;
      const overlaps   = (aStart: number, aEnd: number, sStart: number, sEnd: number) =>
        aStart < sEnd && aEnd > sStart;

      const claimingShifts = (await storage.getShifts()).filter(s => s.agentId === agentId);
      for (const s of claimingShifts) {
        const sNormEnd = normaliseEndUtcServer(s.startUtc, s.endUtc);
        const effStart = s.activeStart ?? s.startUtc;
        const effEnd   = s.activeEnd   ?? sNormEnd;

        // Same-day portion of the slot (clamp to 0–24)
        if (s.dayOfWeek === dow) {
          const slotStart = Math.min(coverStart, 24);
          const slotEnd   = Math.min(coverEnd, 24);
          if (slotStart < slotEnd && overlaps(effStart, effEnd, slotStart, slotEnd)) {
            return res.status(409).json({ message: "Cannot claim coverage during your own active shift hours" });
          }
        }
        // Next-day overflow when slot crosses midnight
        if (coverEnd > 24 && s.dayOfWeek === (dow + 1) % 7) {
          if (overlaps(effStart, effEnd, 0, coverEnd - 24)) {
            return res.status(409).json({ message: "Cannot claim coverage during your own active shift hours" });
          }
        }
      }
    }

    // Prevent duplicate pending claims from same agent for same opportunity
    const existing = (await storage.getClaimsForOpportunity(opportunityId))
      .find(c => c.agentId === agentId && c.status === "pending");
    if (existing) return res.status(409).json({ message: "You already have a pending claim for this opportunity" });

    const agent = await storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const claim = await storage.createClaim({
      opportunityId,
      agentId,
      status: "pending",
      note: typeof req.body.note === "string" ? req.body.note : null,
      createdAt: new Date().toISOString(),
    });

    await storage.createAgentLog({
      agentId,
      date: opportunity.date,
      type: "shift-claim",
      coveredByAgentId: opportunity.coveredByAgentId ?? null,
      notes: null,
      createdAt: new Date().toISOString(),
      actionType: "shift-claimed",
      description: `${agent.name} submitted a claim for the ${opportunity.date} overtime opportunity.`,
    });

    broadcast(["overtime-claims", "agent-logs"]);
    res.json(claim);
  });

  // Agent cancels (undo) their own pending claim
  app.delete("/api/overtime/:id/claim", async (req: Request & { agentId?: number }, res) => {
    const adminToken = readAdminHeaderToken(req);
    const isAdmin = ADMIN_TOKEN && adminToken === ADMIN_TOKEN;
    const agentId = isAdmin ? (req.body.agentId as number | undefined) : getAgentSession(req);

    if (!agentId) return res.status(401).json({ message: "Agent session or admin token required" });

    const opportunityId = Number(req.params.id);
    const claims = await storage.getClaimsForOpportunity(opportunityId);
    const ownClaim = claims.find(c => c.agentId === agentId && c.status === "pending");
    if (!ownClaim) return res.status(404).json({ message: "No pending claim found for this agent" });

    const cancelled = await storage.cancelClaim(ownClaim.id, agentId);

    const agent = await storage.getAgent(agentId);
    const opportunity = (await storage.getOvertimeLogs()).find(r => r.id === opportunityId);
    if (agent && opportunity) {
      await storage.createAgentLog({
        agentId,
        date: opportunity.date,
        type: "shift-claim-cancelled",
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "shift-claimed",
        description: `${agent.name} cancelled their claim for the ${opportunity.date} overtime opportunity.`,
      });
    }

    broadcast(["overtime-claims", "agent-logs"]);
    res.json(cancelled);
  });

  // Manager approves a specific claim (and rejects all others for same opportunity)
  app.post("/api/overtime/:id/approve-claim/:claimId", requireAdmin, async (req, res) => {
    const opportunityId = Number(req.params.id);
    const claimId = Number(req.params.claimId);

    const opportunity = (await storage.getOvertimeLogs()).find(r => r.id === opportunityId);
    if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });

    const claim = (await storage.getClaimsForOpportunity(opportunityId)).find(c => c.id === claimId);
    if (!claim) return res.status(404).json({ message: "Claim not found" });

    // Both claim approval and opportunity update happen atomically
    const approved = await storage.approveClaimAndUpdateOpportunity(claimId, opportunityId, claim.agentId);

    const agent = await storage.getAgent(claim.agentId);
    if (agent) {
      await storage.upsertRecentAgentLog({
        agentId: claim.agentId,
        date: opportunity.date,
        type: "overtime-status",
        coveredByAgentId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        actionType: "overtime-status-changed",
        description: `Manager approved ${agent.name}'s claim for the ${opportunity.date} overtime opportunity.`,
      });
    }

    broadcast(["overtime", "overtime-claims", "agent-logs"]);
    res.json({ ok: true, approved, opportunityId });
  });

  // --- Agent Logs ---
  app.get("/api/agent-logs", requireAgentOrAdmin, async (_req, res) => {
    res.json(await storage.getAgentLogs());
  });

    // Clear all agent logs
    app.delete("/api/agent-logs", requireAdmin, async (_req, res) => {
      await storage.clearAllAgentLogs();
      broadcast(["agent-logs"]);
      res.json({ ok: true });
    });

  app.get("/api/agent-logs/:agentId", requireAgentOrAdmin, async (req, res) => {
    res.json(await storage.getAgentLogsByAgent(Number(req.params.agentId)));
  });

  app.post("/api/agent-logs", async (req, res) => {
    const { agentId, date, type, coveredByAgentId, notes, actionType, description } = req.body;
    if (!agentId || !date || !type) {
      return res.status(400).json({ message: "agentId, date and type are required" });
    }

    const targetAgentId = Number(agentId);
    if (!Number.isFinite(targetAgentId)) {
      return res.status(400).json({ message: "Invalid agentId" });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "date must be YYYY-MM-DD" });
    }

    const ALLOWED_LOG_TYPES = ["sick", "vacation", "overtime-taken", "shift-claim", "shift-claim-cancelled", "overtime-status", "schedule_change", "break", "break-start", "break-end"] as const;
    if (!ALLOWED_LOG_TYPES.includes(type)) {
      return res.status(400).json({ message: `Invalid log type. Allowed: ${ALLOWED_LOG_TYPES.join(", ")}` });
    }

    const admin = isAdminRequest(req);
    const sessionAgentId = getAgentSession(req);
    if (!admin && sessionAgentId !== targetAgentId) {
      return res.status(403).json({ message: "You can only write logs for your own agent session" });
    }

    const log = await storage.upsertRecentAgentLog({
      agentId: targetAgentId,
      date,
      type,
      coveredByAgentId: coveredByAgentId ?? null,
      notes: notes ?? null,
      createdAt: new Date().toISOString(),
      actionType: actionType ?? null,
      description: description ?? null,
    });
    broadcast(["agent-logs"]);
    res.json(log);
  });

  app.delete("/api/agent-logs/:id", requireAdmin, async (req, res) => {
    await storage.deleteAgentLog(Number(req.params.id));
    broadcast(["agent-logs"]);
    res.json({ ok: true });
  });

    // --- Absences (sick / vacation spans) ---
    // Public read (like agents/shifts) so the World view + coverage work for everyone.
    app.get("/api/absences", async (_req, res) => {
      res.json(await storage.getAbsences());
    });

    // Create an absence. Managers can set it for anyone; agents only for themselves.
    app.post("/api/absences", async (req, res) => {
      const admin = isAdminRequest(req);
      const sessionAgentId = getAgentSession(req);
      if (!admin && !sessionAgentId) {
        return res.status(401).json({ message: "Sign in as agent or manager" });
      }
      const { agentId, type, startDate, endDate, note } = req.body as {
        agentId?: number; type?: string; startDate?: string; endDate?: string; note?: string;
      };
      const targetId = Number(agentId);
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return res.status(400).json({ message: "Valid agentId required" });
      }
      if (!admin && sessionAgentId !== targetId) {
        return res.status(403).json({ message: "You can only set your own absence" });
      }
      if (type !== "sick" && type !== "vacation") {
        return res.status(400).json({ message: "type must be 'sick' or 'vacation'" });
      }
      if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
        return res.status(400).json({ message: "startDate and endDate must be YYYY-MM-DD" });
      }
      if (endDate < startDate) {
        return res.status(400).json({ message: "endDate must be on or after startDate" });
      }
      const agent = await storage.getAgent(targetId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const absence = await storage.createAbsence({
        agentId: targetId,
        type,
        startDate,
        endDate,
        note: typeof note === "string" ? note : null,
      });

      const label = type === "vacation" ? "on vacation" : "out sick";
      const span = startDate === endDate ? startDate : `${startDate} – ${endDate}`;
      await storage.createAgentLog({
        agentId: targetId, date: startDate, type,
        coveredByAgentId: null, notes: note ?? null,
        createdAt: new Date().toISOString(),
        actionType: "absence-added",
        description: `${agent.name} is ${label} (${span}).`,
      });
      broadcast(["absences", "agent-logs"]);
      res.json(absence);
    });

    // Cancel an absence. Manager, or the agent who owns it.
    app.delete("/api/absences/:id", async (req, res) => {
      const id = Number(req.params.id);
      const admin = isAdminRequest(req);
      const sessionAgentId = getAgentSession(req);
      const existing = (await storage.getAbsences()).find(a => a.id === id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!admin && sessionAgentId !== existing.agentId) {
        return res.status(403).json({ message: "You can only cancel your own absence" });
      }
      await storage.deleteAbsence(id);
      const agent = await storage.getAgent(existing.agentId);
      if (agent) {
        await storage.createAgentLog({
          agentId: existing.agentId, date: new Date().toISOString().slice(0, 10), type: existing.type,
          coveredByAgentId: null, notes: null,
          createdAt: new Date().toISOString(),
          actionType: "absence-removed",
          description: `${agent.name}'s ${existing.type} (${existing.startDate}${existing.startDate === existing.endDate ? "" : ` – ${existing.endDate}`}) was cancelled.`,
        });
      }
      broadcast(["absences", "agent-logs"]);
      res.json({ ok: true });
    });

    // --- Backup / Restore ---
    app.get("/api/export", requireAdmin, async (_req, res) => {
      const data = await storage.exportAll();
      res.json({ ...data, exportedAt: new Date().toISOString(), version: 1 });
    });

  app.post("/api/import", requireAdmin, async (req, res) => {
    try {
      const normalized = normalizeImportPayload(req.body);
      await storage.importAll({
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

  // ── Support Cases ────────────────────────────────────────────────────────────
  const SUPPORT_SHEET_ID = "1a-VmACkxGzu5MLnuHKPo8Z797JqSHBxEB_XWi_HZXds";
  let supportCasesCache: { data: unknown[]; fetchedAt: number } | null = null;
  const SUPPORT_TTL_MS = 60_000;

  function parseSheetCSV(text: string): string[][] {
    const rows: string[][] = [];
    let pos = 0;
    const n = text.length;
    while (pos < n) {
      const row: string[] = [];
      while (pos < n) {
        if (text[pos] === '"') {
          let field = "";
          pos++;
          while (pos < n) {
            if (text[pos] === '"') {
              if (pos + 1 < n && text[pos + 1] === '"') { field += '"'; pos += 2; }
              else { pos++; break; }
            } else { field += text[pos]; pos++; }
          }
          row.push(field);
        } else {
          let field = "";
          while (pos < n && text[pos] !== "," && text[pos] !== "\r" && text[pos] !== "\n") {
            field += text[pos]; pos++;
          }
          row.push(field);
        }
        if (pos < n && text[pos] === ",") { pos++; } else { break; }
      }
      if (row.length > 0 && row.some(f => f.trim())) rows.push(row);
      if (pos < n && text[pos] === "\r") pos++;
      if (pos < n && text[pos] === "\n") pos++;
    }
    return rows;
  }

  app.get("/api/support-cases", async (_req, res) => {
    const now = Date.now();
    if (supportCasesCache && now - supportCasesCache.fetchedAt < SUPPORT_TTL_MS) {
      return res.json({ cases: supportCasesCache.data, fetchedAt: supportCasesCache.fetchedAt });
    }
    try {
      const url = `https://docs.google.com/spreadsheets/d/${SUPPORT_SHEET_ID}/export?format=csv`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Shiftclock/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        if (supportCasesCache) return res.json({ cases: supportCasesCache.data, fetchedAt: supportCasesCache.fetchedAt, stale: true });
        return res.status(503).json({ message: "Google Sheet not accessible. Share it publicly (anyone with link → Viewer)." });
      }
      const text = await resp.text();
      const rows = parseSheetCSV(text);
      if (rows.length < 2) {
        return res.status(503).json({ message: "Sheet returned no data." });
      }
      const [, ...dataRows] = rows;
      const cases = dataRows
        .filter(row => row[2]?.trim())
        .map(row => ({
          dateTime: row[0]?.trim() ?? "",
          caseId: row[2]?.trim() ?? "",
          agentName: row[3]?.trim() ?? "",
          category: row[4]?.trim() ?? "",
          status: row[5]?.trim() ?? "",
          message: row[6]?.trim() ?? "",
          channel: row[7]?.trim() ?? "",
          threadLink: row[8]?.trim() ?? "",
          intercomLink: row[9]?.trim() ?? "",
          note: row[10]?.trim() ?? "",
        }))
        .reverse();
      supportCasesCache = { data: cases, fetchedAt: now };
      return res.json({ cases, fetchedAt: now });
    } catch {
      if (supportCasesCache) return res.json({ cases: supportCasesCache.data, fetchedAt: supportCasesCache.fetchedAt, stale: true });
      return res.status(503).json({ message: "Failed to fetch support cases from Google Sheets." });
    }
  });
}
