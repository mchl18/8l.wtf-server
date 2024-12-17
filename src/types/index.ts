import { Transaction } from "../lib/adapters/transaction";

export type DbAdapter = {
  transaction: () => Promise<Transaction>;
  smembers: (key: string) => Promise<string[]>;
  get: <T = string>(key: string) => Promise<T | null>;
  set: (key: string, value: any, options?: { ex?: number }) => Promise<void>;
  sadd: (key: string, value: string) => Promise<void | number>;
  srem: (key: string, value: string) => Promise<void | number>;
  del: (key: string) => Promise<void | number>;
  sismember: (key: string, value: string) => Promise<boolean>;
};

export type DbType = "vercel-kv" | "redis" | "mongo" | "postgres" | "mysql" | "sqlite";
export type ShortenedUrl = {
  shortId: string;
  url: string;
  fullUrl: string;
  createdAt?: string;
  expiresAt?: string;
  isEncrypted?: boolean;
  error?: string;
};

export type GetUrlsResponse = {
  urls: ShortenedUrl[];
};
