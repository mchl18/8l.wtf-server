import { DbAdapter } from "../../types/index.js";

export interface Transaction {
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, value: string): Promise<boolean>;
  sadd(key: string, value: string): Promise<void | number>;
  srem(key: string, value: string): Promise<void | number>;
  del(key: string): Promise<void | number>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TransactionalDbAdapter extends DbAdapter {
  transaction(): Promise<Transaction>;
}
