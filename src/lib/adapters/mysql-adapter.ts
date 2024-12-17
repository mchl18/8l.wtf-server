import { DbAdapter } from "../../types/index.js";
import mysql from "mysql2/promise";

// Setup script for MySQL adapter:
/*
-- Create the key_values table for storing key-value pairs with expiration
CREATE TABLE IF NOT EXISTS key_values (
  key_name VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_key_values_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create the set_members table for storing sets
CREATE TABLE IF NOT EXISTS set_members (
  set_key VARCHAR(255),
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_key, value(255)),
  INDEX idx_set_members_key (set_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Create a cleanup procedure for expired keys
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS cleanup_expired_keys()
BEGIN
  DELETE FROM key_values WHERE expires_at IS NOT NULL AND expires_at <= NOW();
END //
DELIMITER ;

-- Create an event to periodically clean up expired keys (runs every hour)
CREATE EVENT IF NOT EXISTS cleanup_expired_keys_event
ON SCHEDULE EVERY 1 HOUR
DO CALL cleanup_expired_keys();

-- Ensure event scheduler is running
SET GLOBAL event_scheduler = ON;
*/
let instance: DbAdapter | null = null;
export const createMysqlAdapter = ({
  connectionString,
}: {
  connectionString: string;
}): DbAdapter => {
  if (instance) {
    return instance;
  }
  let pool: mysql.Pool;

  const getPool = () => {
    if (!pool) {
      pool = mysql.createPool(connectionString);
    }
    return pool;
  };

  if (!instance) {
    instance = {
      smembers: async (key) => {
        const pool = getPool();
        const [rows] = await pool.query(
          "SELECT value FROM set_members WHERE set_key = ?",
          [key]
        );
        return (rows as any[]).map((row) => row.value);
      },

      get: async (key) => {
        const pool = getPool();
        const [rows] = await pool.query(
          "SELECT value FROM key_values WHERE key_name = ? AND (expires_at IS NULL OR expires_at > NOW())",
          [key]
        );
        const row = (rows as any[])[0];
        return row ? row.value : null;
      },

      set: async (key, value, options) => {
        const pool = getPool();
        const expiresAt = options?.ex
          ? new Date(Date.now() + options.ex * 1000)
          : null;

        await pool.query(
          "INSERT INTO key_values (key_name, value, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, expires_at = ?",
          [key, value, expiresAt, value, expiresAt]
        );
      },

      sadd: async (key, value) => {
        const pool = getPool();
        await pool.query(
          "INSERT IGNORE INTO set_members (set_key, value) VALUES (?, ?)",
          [key, value]
        );
      },

      srem: async (key, value) => {
        const pool = getPool();
        await pool.query(
          "DELETE FROM set_members WHERE set_key = ? AND value = ?",
          [key, value]
        );
      },

      del: async (key) => {
        const pool = getPool();
        await pool.query("DELETE FROM key_values WHERE key_name = ?", [key]);
      },

      sismember: async (key, value) => {
        const pool = getPool();
        const [rows] = await pool.query(
          "SELECT 1 FROM set_members WHERE set_key = ? AND value = ? LIMIT 1",
          [key, value]
        );
        return (rows as any[]).length > 0;
      },
      transaction: async () => {
        return {
          get: async (key) => await instance!.get(key),
          set: async (key, value, options) =>
            await instance!.set(key, value, options),
          smembers: async (key) => await instance!.smembers(key),
          sismember: async (key, value) =>
            await instance!.sismember(key, value),
          sadd: async (key, value) => await instance!.sadd(key, value),
          srem: async (key, value) => await instance!.srem(key, value),
          del: async (key) => await instance!.del(key),
          commit: async () => {},
          rollback: async () => {},
        };
      },
    };
  }
  return instance;
};
