import { DbAdapter } from "../../types/index.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export const createSqliteAdapter = ({
  filename,
}: {
  filename?: string;
} = {}): DbAdapter => {
  let db: any;

  const getDb = async () => {
    if (!filename) {
      throw new Error("Filename is required for SQLite adapter");
    }
    if (!db) {
      db = await open({
        filename,
        driver: sqlite3.Database,
      });

      // Create tables if they don't exist
      await db.exec(`
        CREATE TABLE IF NOT EXISTS key_values (
          key_name TEXT PRIMARY KEY,
          value TEXT,
          expires_at DATETIME
        );
        
        CREATE TABLE IF NOT EXISTS set_members (
          set_key TEXT,
          value TEXT,
          PRIMARY KEY (set_key, value)
        );
      `);
    }
    return db;
  };

  return {
    smembers: async (key) => {
      const db = await getDb();
      const rows = await db.all(
        "SELECT value FROM set_members WHERE set_key = ?",
        [key]
      );
      return rows.map((row: any) => row.value);
    },

    get: async (key) => {
      const db = await getDb();
      const row = await db.get(
        "SELECT value FROM key_values WHERE key_name = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
        [key]
      );
      return row ? row.value : null;
    },

    set: async (key, value, options) => {
      const db = await getDb();
      const expiresAt = options?.ex
        ? new Date(Date.now() + options.ex * 1000).toISOString()
        : null;

      await db.run(
        `INSERT INTO key_values (key_name, value, expires_at) 
         VALUES (?, ?, ?)
         ON CONFLICT(key_name) DO UPDATE SET 
         value = excluded.value,
         expires_at = excluded.expires_at`,
        [key, value, expiresAt]
      );
    },

    sadd: async (key, value) => {
      const db = await getDb();
      await db.run(
        "INSERT OR IGNORE INTO set_members (set_key, value) VALUES (?, ?)",
        [key, value]
      );
    },

    srem: async (key, value) => {
      const db = await getDb();
      await db.run("DELETE FROM set_members WHERE set_key = ? AND value = ?", [
        key,
        value,
      ]);
    },

    del: async (key) => {
      const db = await getDb();
      await db.run("DELETE FROM key_values WHERE key_name = ?", [key]);
    },

    sismember: async (key, value) => {
      const db = await getDb();
      const row = await db.get(
        "SELECT 1 FROM set_members WHERE set_key = ? AND value = ? LIMIT 1",
        [key, value]
      );
      return !!row;
    },

    transaction: async () => {
      return {
        get: async <T = string>(key: string): Promise<T | null> => {
          const value = await db.get(key);
          return value ? (value as T) : null;
        },
        set: async (key, value, options) => {
          const db = await getDb();
          const expiresAt = options?.ex
            ? new Date(Date.now() + options.ex * 1000).toISOString()
            : null;
        },

        smembers: async (key) =>
          await db.all("SELECT value FROM set_members WHERE set_key = ?", [
            key,
          ]),
        sismember: async (key, value) => {
          const row = await db.get(
            "SELECT 1 FROM set_members WHERE set_key = ? AND value = ? LIMIT 1",
            [key, value]
          );
          return !!row;
        },
        sadd: async (key, value) =>
          await db.run(
            "INSERT OR IGNORE INTO set_members (set_key, value) VALUES (?, ?)",
            [key, value]
          ),
        srem: async (key, value) =>
          await db.run(
            "DELETE FROM set_members WHERE set_key = ? AND value = ?",
            [key, value]
          ),
        del: async (key) =>
          await db.run("DELETE FROM key_values WHERE key_name = ?", [key]),
        commit: async () => {},
        rollback: async () => {},
      };
    },
  };
};
