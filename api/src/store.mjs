/**
 * Store selector. This is the only place that decides which storage backend
 * runs, so the rest of the API (and the gate above all) never knows or cares.
 *
 * The Store interface the gate is written against:
 *   find / findOne / insertOne / findOneAndUpdate / updateOne / removeOne /
 *   count / init / close
 */
import { createMemoryStore } from "./stores/memory.mjs";

/**
 * @param {{store: "mongo"|"memory", mongo: {url: string, dbName: string}|null}} config
 * @returns {Promise<object>} an initialised store
 */
export async function createStore(config) {
  if (config.store === "memory") {
    const store = createMemoryStore();
    await store.init();
    return store;
  }

  const { createMongoStore } = await import("./stores/mongo.mjs");
  if (!config.mongo) {
    throw new Error("COOKSY_STORE=mongo requires MONGO_URL.");
  }
  const store = createMongoStore(config.mongo);
  await store.init();
  return store;
}

export { createMemoryStore };
