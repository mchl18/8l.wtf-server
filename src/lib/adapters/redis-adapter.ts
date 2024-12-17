import { DbAdapter } from "../../types/index.js";
import { Redis } from "ioredis";
import { kv } from "@vercel/kv";

type RedisLikeClient = Redis | typeof kv;

interface AdapterOptions {
  client: RedisLikeClient;
  type: "redis" | "vercel-kv";
}

export const createRedisLikeAdapter = ({
  client,
  type,
}: AdapterOptions): DbAdapter => {
  const isRedis = type === "redis";

  const handleSet = async (
    key: string,
    value: any,
    options?: { ex?: number }
  ) => {
    if (options?.ex) {
      if (isRedis) {
        await (client as Redis).set(key, value, "EX", options.ex);
      } else {
        await (client as typeof kv).set(key, value, { ex: options.ex });
      }
    } else {
      await client.set(key, value);
    }
  };

  const handleGet = async <T = string>(key: string): Promise<T | null> => {
    const value = await client.get(key);
    return value ? (value as T) : null;
  };

  const handleSisMember = async (
    key: string,
    value: string
  ): Promise<boolean> => {
    return (await client.sismember(key, value)) === 1;
  };

  const adapter: DbAdapter = {
    smembers: async (key) => await client.smembers(key),
    get: handleGet,
    set: handleSet,
    sadd: async (key, value) => await client.sadd(key, value),
    srem: async (key, value) => await client.srem(key, value),
    del: async (key) => await client.del(key),
    sismember: handleSisMember,
    transaction: async () => ({
      get: handleGet,
      set: handleSet,
      smembers: async (key: string) => await client.smembers(key),
      sismember: handleSisMember,
      sadd: async (key: string, value: string) => await client.sadd(key, value),
      srem: async (key: string, value: string) => await client.srem(key, value),
      del: async (key: string) => await client.del(key),
      commit: async () => {}, // No-op for both implementations
      rollback: async () => {}, // No-op for both implementations
    }),
  };

  return adapter;
};

// Factory function to create Redis adapter
export const createRedisAdapter = ({
  connectionString = process.env.REDIS_URL,
}): DbAdapter => {
  if (!connectionString) {
    throw new Error("REDIS_URL is not set");
  }

  const redis = new Redis(connectionString);
  return createRedisLikeAdapter({ client: redis, type: "redis" });
};

// Factory function to create Vercel KV adapter
export const createKvAdapter = (): DbAdapter => {
  return createRedisLikeAdapter({ client: kv, type: "vercel-kv" });
};
