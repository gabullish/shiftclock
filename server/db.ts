import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@shared/schema";

const url = process.env.TURSO_DATABASE_URL ?? "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({ url, authToken });
export const db = drizzle(client, { schema });

// Run table migrations on startup — idempotent, safe on existing DBs
export async function initDb() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      avatar_url TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      role TEXT NOT NULL DEFAULT 'Agent',
      off_weekend INTEGER NOT NULL DEFAULT 1,
      off_cycle_start TEXT,
      break_active_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_utc REAL NOT NULL,
      end_utc REAL NOT NULL,
      active_start REAL,
      active_end REAL,
      break_start REAL
    );

    CREATE TABLE IF NOT EXISTS overtime_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      overtime_hours REAL NOT NULL DEFAULT 0,
      released_hours REAL NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      origin TEXT,
      covered_by_agent_id INTEGER,
      status_updated_at TEXT,
      from_shift_id INTEGER,
      day_of_week INTEGER,
      cover_start_utc REAL,
      cover_end_utc REAL
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      cover_pct REAL,
      covered_by_agent_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      action_type TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS overtime_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_order INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shifts_agent_day ON shifts(agent_id, day_of_week);
    CREATE INDEX IF NOT EXISTS idx_overtime_agent_date_status ON overtime_log(agent_id, date, status);
    CREATE INDEX IF NOT EXISTS idx_overtime_from_shift_status ON overtime_log(from_shift_id, status);
    CREATE INDEX IF NOT EXISTS idx_claims_opportunity ON overtime_claims(opportunity_id, status);
    CREATE INDEX IF NOT EXISTS idx_claims_agent ON overtime_claims(agent_id, status);
  `);
}
