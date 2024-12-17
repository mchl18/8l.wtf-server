import { DbAdapter } from "../../types/index.js";
import { MongoClient } from "mongodb";
let instance: DbAdapter | null = null;
export const createMongoAdapter = ({
  connectionString,
}: {
  connectionString: string;
}): DbAdapter => {
  if (instance) {
    return instance;
  }
  const client = new MongoClient(connectionString);
  const db = client.db();
  const keyValueCollection = db.collection("keyValue");
  const setMembersCollection = db.collection("setMembers");
  if (!instance) {
    instance = {
      smembers: async (key) => {
        const results = await setMembersCollection.find({ key }).toArray();
        return results.map((doc) => doc.value);
      },

      get: async (key) => {
        const doc = await keyValueCollection.findOne({ key });
        if (!doc) return null;
        if (doc.expiresAt && new Date() > doc.expiresAt) {
          await keyValueCollection.deleteOne({ key });
          return null;
        }
        return doc.value;
      },

      set: async (key, value, options) => {
        const doc = {
          key,
          value,
          expiresAt: options?.ex
            ? new Date(Date.now() + options.ex * 1000)
            : null,
        };
        await keyValueCollection.updateOne(
          { key },
          { $set: doc },
          { upsert: true }
        );
      },

      sadd: async (key, value) => {
        await setMembersCollection.updateOne(
          { key, value },
          { $set: { key, value } },
          { upsert: true }
        );
      },

      srem: async (key, value) => {
        await setMembersCollection.deleteOne({ key, value });
      },

      del: async (key) => {
        await keyValueCollection.deleteOne({ key });
        await setMembersCollection.deleteMany({ key });
      },

      sismember: async (key, value) => {
        const doc = await setMembersCollection.findOne({ key, value });
        return !!doc;
      },
      transaction: async () => {
        if (!instance) {
          throw new Error("Mongo adapter not initialized");
        }
        return {
          get: async (key) => await instance!.get(key),
          set: async (key, value, options) => {
            await instance!.set(key, value, options);
          },
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
