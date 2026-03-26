import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";

// RAILWAY_VOLUME_MOUNT_PATH is set when a Railway volume is attached
// Falls back to ./data.db for local dev and initial Railway deploy
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "data.db")
  : "./data.db";

const sqlite = new Database(dbPath);

// Auto-create tables if they don't exist (safe on existing DBs)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    role TEXT NOT NULL DEFAULT 'Agent',
    off_weekend INTEGER NOT NULL DEFAULT 1,
    off_cycle_start TEXT
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
    note TEXT
  );
`);

export const db = drizzle(sqlite, { schema });
