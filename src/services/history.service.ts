import Database from "@tauri-apps/plugin-sql";
import { HistoryEntry, AIMode } from "../types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:history.db");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        original_text TEXT NOT NULL,
        result_text TEXT NOT NULL,
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

export async function addHistory(
  original: string,
  result: string,
  mode: AIMode
): Promise<void> {
  if (!isTauri()) return;
  const conn = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await conn.execute(
    "INSERT INTO history (id, original_text, result_text, mode, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, original, result, mode, now]
  );
}

export async function getHistory(limit = 50): Promise<HistoryEntry[]> {
  if (!isTauri()) return [];
  const conn = await getDb();
  return conn.select<HistoryEntry[]>(
    "SELECT * FROM history ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  if (!isTauri()) return;
  const conn = await getDb();
  await conn.execute("DELETE FROM history WHERE id = $1", [id]);
}

export async function clearHistory(): Promise<void> {
  if (!isTauri()) return;
  const conn = await getDb();
  await conn.execute("DELETE FROM history");
}
