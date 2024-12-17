import { DbAdapter, DbType } from "../../types/index.js";
import { createPostgresAdapter } from "./postgres-adapter.js";
import { createMongoAdapter } from "./mongo-adapter.js";
import { createMysqlAdapter } from "./mysql-adapter.js";
import { createSqliteAdapter } from "./sqlite-adapter.js";
import { createKvAdapter, createRedisAdapter } from "./redis-adapter.js";
let db: DbAdapter;
export const getDatabase = async ({
  type,
}: {
  type?: DbType;
} = {}): Promise<DbAdapter> => {
  if (db) {
    return db;
  }
  console.log("getDatabase", type);
  if (type === "vercel-kv") {
    if (!process.env.KV_URL) {
      throw new Error("KV_URL is not set");
    }
    db = createKvAdapter();
    return db;
  }
  if (type === "redis") {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is not set");
    }
    const redis = createRedisAdapter({
      connectionString: process.env.REDIS_URL,
    });
    db = redis;
    return redis;
  }
  if (type === "mongo") {
    if (!process.env.MONGO_URL) {
      throw new Error("MONGO_URL is not set");
    }
    const mongo = createMongoAdapter({
      connectionString: process.env.MONGO_URL!,
    });
    db = mongo;
    return mongo;
  }
  if (type === "postgres") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    const postgres = await createPostgresAdapter({
      connectionString: process.env.DATABASE_URL!,
    });
    db = postgres;
    return postgres;
  }
  if (type === "mysql") {
    if (!process.env.MYSQL_URL) {
      throw new Error("MYSQL_URL is not set");
    }
    const mysql = createMysqlAdapter({
      connectionString: process.env.MYSQL_URL!,
    });
    db = mysql;
    return mysql;
  }
  if (type === "sqlite") {
    const sqlite = createSqliteAdapter({
      filename: process.env.SQLITE_FILENAME || ":memory:",
    });
    db = sqlite;
    return sqlite;
  }
  const envType = process.env.NEXT_PUBLIC_DB_TYPE;
  if (!type && envType) {
    if (
      ["vercel-kv", "redis", "mongo", "postgres", "mysql", "sqlite"].includes(
        envType
      )
    ) {
      db = await getDatabase({
        type: envType as DbType,
      });
      return db;
    }
    throw new Error("Invalid database type");
  }
  if (!type) {
    console.log(
      "No database type set, creating database adapter for Vercel KV"
    );
    db = createKvAdapter();
    return db;
  }
  throw new Error("Database type not set");
};
