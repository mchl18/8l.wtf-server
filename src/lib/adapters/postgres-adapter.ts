import { DbAdapter } from "../../types/index.js";
import { Pool, PoolClient } from "pg";
import { Transaction } from "./transaction.js";

const INIT_SCRIPT = `
-- Create initialization tracking table
CREATE TABLE IF NOT EXISTS db_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create key_value table for storing key-value pairs with expiration
CREATE TABLE IF NOT EXISTS key_value (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create set_members table for storing sets
CREATE TABLE IF NOT EXISTS set_members (
    key TEXT,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key, value)
);

-- Create index for expires_at to optimize expiration queries
CREATE INDEX IF NOT EXISTS idx_key_value_expires_at ON key_value(expires_at)
WHERE expires_at IS NOT NULL;

-- Create index for set lookups
CREATE INDEX IF NOT EXISTS idx_set_members_key ON set_members(key);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE OR REPLACE TRIGGER update_key_value_updated_at
    BEFORE UPDATE ON key_value
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to clean up expired keys
CREATE OR REPLACE FUNCTION cleanup_expired_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM key_value WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Create a reusable function to add a cron job
CREATE OR REPLACE FUNCTION create_cron_job(
    job_name TEXT,
    schedule TEXT,
    command TEXT
) RETURNS void AS $$
BEGIN
    -- Check if pg_cron extension is available
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        -- Remove existing job if it exists
        PERFORM cron.unschedule(job_name);
        -- Schedule new job
        PERFORM cron.schedule(job_name, schedule, command);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Attempt to create the cleanup cron job if pg_cron is available
DO $$
BEGIN
    -- Schedule cleanup job to run every hour
    PERFORM create_cron_job(
        'cleanup_expired_keys',
        '0 * * * *',
        'SELECT cleanup_expired_keys()'
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron extension not available. Automatic cleanup will not be scheduled.';
END $$;`;

// Define retry configuration
const RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 100,
};
type ConnectionState = {
  pool: Pool | null;
  initPromise: Promise<void> | null;
};

const state: ConnectionState = {
  pool: null,
  initPromise: null,
};

export class PostgresAdapter implements DbAdapter {
  private pool: Pool;
  private static instance: PostgresAdapter | null = null;
  private async withRetry<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = RETRY_OPTIONS.initialDelayMs;

    for (let attempt = 0; attempt < RETRY_OPTIONS.maxRetries; attempt++) {
      const client = await this.pool.connect();
      try {
        return await operation(client);
      } catch (error: any) {
        lastError = error;
        if (error.code === "40P01") {
          // Deadlock error code
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }
    throw lastError || new Error("Operation failed after retries");
  }

  async smembers<T = string>(key: string): Promise<T[]> {
    return this.withRetry(async (client) => {
      const result = await client.query(
        "SELECT value FROM set_members WHERE key = $1",
        [key]
      );
      return result.rows.map((row: { value: T }) => row.value);
    });
  }

  async get<T = string>(key: string): Promise<T | null> {
    return this.withRetry(async (client) => {
      const result = await client.query(
        "SELECT value FROM key_value WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())",
        [key]
      );
      try {
        const res = JSON.parse(result.rows[0]?.value || "null") || null;
        return res as T;
      } catch (error) {
        // console.error("Error parsing JSON", error);
        return result.rows[0]?.value || null;
      }
    });
  }

  async set(
    key: string,
    value: string,
    options?: { ex?: number }
  ): Promise<void> {
    return this.withRetry(async (client) => {
      await client.query("BEGIN");
      try {
        if (options?.ex) {
          await client.query(
            "INSERT INTO key_value (key, value, expires_at) VALUES ($1, $2, NOW() + interval '1 second' * $3) " +
              "ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + interval '1 second' * $3",
            [key, value, options.ex]
          );
        } else {
          await client.query(
            "INSERT INTO key_value (key, value, expires_at) VALUES ($1, $2, NULL) " +
              "ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NULL",
            [key, value]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async sadd(key: string, value: string): Promise<void> {
    return this.withRetry(async (client) => {
      await client.query(
        "INSERT INTO set_members (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [key, value]
      );
    });
  }

  async srem(key: string, value: string): Promise<void> {
    return this.withRetry(async (client) => {
      await client.query(
        "DELETE FROM set_members WHERE key = $1 AND value = $2",
        [key, value]
      );
    });
  }
  // private pool: Pool;
  // private static instance: PostgresAdapter | null = null;

  private constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 1, // Keep single connection for serverless
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      log: (msg: string) => console.log(`PG DEBUG: ${msg}`),
      // ssl:
      //   process.env.NODE_ENV === "production"
      //     ? {
      //         rejectUnauthorized: true,
      //       }
      //     : undefined,
    });

    this.pool.on("error", (err: any, client: any) => {
      console.error("Unexpected error on idle client", err);
      // Optionally reset the pool on fatal errors
      if (err.message.includes("Connection terminated")) {
        state.pool = null;
        state.initPromise = null;
      }
    });
  }

  public static async getInstance(
    connectionString: string
  ): Promise<PostgresAdapter> {
    // If we have an instance and its pool is healthy, return it
    if (PostgresAdapter.instance?.pool) {
      try {
        await PostgresAdapter.instance.pool.query("SELECT 1");
        return PostgresAdapter.instance;
      } catch (error) {
        // Pool is not healthy, reset everything
        await PostgresAdapter.instance?.close();
        PostgresAdapter.instance = null;
        state.pool = null;
        state.initPromise = null;
      }
    }

    // If we're already initializing, wait for that to complete
    if (state.initPromise) {
      await state.initPromise;
      if (PostgresAdapter.instance) {
        return PostgresAdapter.instance;
      }
    }

    // Start new initialization
    state.initPromise = (async () => {
      try {
        const adapter = new PostgresAdapter(connectionString);
        await adapter.initialize();
        PostgresAdapter.instance = adapter;
        state.pool = adapter.pool;
        return;
      } catch (error) {
        // Clean up on failure
        state.pool = null;
        PostgresAdapter.instance = null;
        throw error;
      } finally {
        state.initPromise = null;
      }
    })();

    await state.initPromise;

    if (!PostgresAdapter.instance) {
      throw new Error("Failed to initialize database");
    }

    return PostgresAdapter.instance;
  }

  private async initialize(): Promise<void> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();

      // First create the metadata table to track initialization
      await client.query(`
        CREATE TABLE IF NOT EXISTS db_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Check if DB was already initialized
      const result = await client.query(
        "SELECT value FROM db_metadata WHERE key = 'initialized'"
      );

      if (result.rows.length === 0) {
        // DB not initialized yet, run init script
        await client.query(INIT_SCRIPT);

        // Mark as initialized
        await client.query(
          "INSERT INTO db_metadata (key, value) VALUES ('initialized', 'true')"
        );
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async del(key: string): Promise<void> {
    return this.withRetry(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM key_value WHERE key = $1", [key]);
        await client.query("DELETE FROM set_members WHERE key = $1", [key]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async sismember(key: string, value: string): Promise<boolean> {
    return this.withRetry(async (client) => {
      const result = await client.query(
        "SELECT 1 FROM set_members WHERE key = $1 AND value = $2",
        [key, value]
      );
      return result.rows.length > 0;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction(): Promise<Transaction> {
    console.log('Starting transaction');
    let client: PoolClient | null = null;
    
    try {
      console.log('Getting client from pool');
      client = await this.pool.connect();
      console.log('Got client, beginning transaction');
      await client.query("BEGIN");
      console.log('Transaction began');
  
      const transaction: Transaction = {
        get: async <T = string>(key: string) => {
          console.log(`Transaction get: ${key}`);
          const result = await client!.query(
            "SELECT value FROM key_value WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())",
            [key]
          );
          try {
            const res = JSON.parse(result.rows[0]?.value || "null") || null;
            return res as T;
          } catch (error) {
            return result.rows[0]?.value || null;
          }
        },
  
        set: async (key: string, value: string, options?: { ex?: number }) => {
          console.log(`Transaction set: ${key}`);
          if (options?.ex) {
            await client!.query(
              "INSERT INTO key_value (key, value, expires_at) VALUES ($1, $2, NOW() + interval '1 second' * $3) " +
                "ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + interval '1 second' * $3",
              [key, value, options.ex]
            );
          } else {
            await client!.query(
              "INSERT INTO key_value (key, value, expires_at) VALUES ($1, $2, NULL) " +
                "ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NULL",
              [key, value]
            );
          }
        },
  
        smembers: async (key: string) => {
          console.log(`Transaction smembers: ${key}`);
          const result = await client!.query(
            "SELECT value FROM set_members WHERE key = $1",
            [key]
          );
          return result.rows.map((row: { value: string }) => row.value);
        },
  
        sismember: async (key: string, value: string) => {
          console.log(`Transaction sismember: ${key}`);
          const result = await client!.query(
            "SELECT 1 FROM set_members WHERE key = $1 AND value = $2",
            [key, value]
          );
          return result.rows.length > 0;
        },
  
        sadd: async (key: string, value: string) => {
          console.log(`Transaction sadd: ${key}`);
          await client!.query(
            "INSERT INTO set_members (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [key, value]
          );
        },
  
        srem: async (key: string, value: string) => {
          console.log(`Transaction srem: ${key}`);
          await client!.query(
            "DELETE FROM set_members WHERE key = $1 AND value = $2",
            [key, value]
          );
        },
  
        del: async (key: string) => {
          console.log(`Transaction del: ${key}`);
          await client!.query("DELETE FROM key_value WHERE key = $1", [key]);
          await client!.query("DELETE FROM set_members WHERE key = $1", [key]);
        },
  
        commit: async () => {
          if (!client) {
            console.warn('Commit called on released client');
            return;
          }
          console.log('Committing transaction');
          try {
            await client.query("COMMIT");
          } finally {
            console.log('Releasing client after commit');
            client.release();
            client = null;
          }
        },
  
        rollback: async () => {
          if (!client) {
            console.warn('Rollback called on released client');
            return;
          }
          console.log('Rolling back transaction');
          try {
            await client.query("ROLLBACK");
          } catch (error) {
            console.error('Error during rollback:', error);
          } finally {
            console.log('Releasing client after rollback');
            client.release();
            client = null;
          }
        },
      };
  
      return transaction;
    } catch (error) {
      console.error('Error setting up transaction:', error);
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error('Error rolling back failed transaction:', rollbackError);
        } finally {
          client.release();
        }
      }
      throw error;
    }
  }
}

export const createPostgresAdapter = async ({
  connectionString,
}: {
  connectionString: string;
}): Promise<DbAdapter> => {
  return PostgresAdapter.getInstance(connectionString);
};
