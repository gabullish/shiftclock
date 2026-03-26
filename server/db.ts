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
export const db = drizzle(sqlite, { schema });
