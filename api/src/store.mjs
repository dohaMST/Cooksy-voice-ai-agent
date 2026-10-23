/**
 * Storage abstraction for zafran-api.
 *
 * The approval gate is written once against this tiny interface and is then
 * verified by the tests against the in-memory store. The MongoDB store is the
 * one that ships; it implements the same semantics through the official driver.
 *
 * Only the operators the gate actually needs are supported: equality matches,
 * and `$gt` / `$lt` for the expiry check. This is not a general query engine.
 */

/**
 * @typedef {object} Store
 * @property {(coll: string, filter: object) => Promise<object[]>} find
 * @property {(coll: string, filter: object) => Promise<object|null>} findOne
 * @property {(coll: string, doc: object) => Promise<object>} insertOne
 * @property {(coll: string, filter: object, update: object) => Promise<{doc: object|null, matched: boolean}>} findOneAndUpdate
 * @property {(coll: string, filter: object, update: object) => Promise<{matched: boolean, modified: number}>} updateOne
 * @property {(coll: string, filter: object) => Promise<number>} count
 * @property {(coll: string, filter: object) => Promise<{removed: boolean}>} removeOne
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} close
 */

/** Does a document satisfy a minimal filter (equality + $gt/$lt)? */
export function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$gt" in cond && !(value > cond.$gt)) return false;
      if ("$lt" in cond && !(value < cond.$lt)) return false;
      if ("$in" in cond && !cond.$in.includes(value)) return false;
    } else if (Array.isArray(cond)) {
      const docValue = Array.isArray(value) ? value : [];
      if (!cond.every((v) => docValue.includes(v))) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

/** Apply a `$set` update to a document (the only operator the gate uses). */
function applyUpdate(doc, update) {
  const next = { ...doc };
  if (update.$set) Object.assign(next, update.$set);
  return next;
}

/** In-memory store. Single-process, synchronous under the hood, atomic per call. */
export function createMemoryStore() {
  /** @type {Map<string, object[]>} */
  const data = new Map();
  let idCounter = 0;

  const coll = (name) => {
    if (!data.has(name)) data.set(name, []);
    return data.get(name);
  };

  const autoId = (doc) =>
    doc._id ? doc : { _id: `mem_${(++idCounter).toString(36)}_${Date.now().toString(36)}`, ...doc };

  return {
    async init() {},
    async find(name, filter) {
      return coll(name).filter((d) => matches(d, filter)).map((d) => ({ ...d }));
    },
    async findOne(name, filter) {
      const hit = coll(name).find((d) => matches(d, filter));
      return hit ? { ...hit } : null;
    },
    async insertOne(name, doc) {
      const stored = autoId(doc);
      coll(name).push(stored);
      return { ...stored };
    },
    async findOneAndUpdate(name, filter, update) {
      const list = coll(name);
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { doc: null, matched: false };
      const next = applyUpdate(list[idx], update);
      list[idx] = next;
      return { doc: { ...next }, matched: true };
    },
    async updateOne(name, filter, update) {
      const list = coll(name);
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { matched: false, modified: 0 };
      list[idx] = applyUpdate(list[idx], update);
      return { matched: true, modified: 1 };
    },
    async count(name, filter) {
      return coll(name).filter((d) => matches(d, filter)).length;
    },
    async removeOne(name, filter) {
      const list = coll(name);
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { removed: false };
      list.splice(idx, 1);
      return { removed: true };
    },
    async close() {
      data.clear();
    },
  };
}

/**
 * MongoDB store. Lazy-imports the driver so the tests (and any run without
 * Docker) never require the dependency to be installed or a server to be up.
 */
export function createMongoStore(url, dbName) {
  let client = null;
  let db = null;
  const coll = (name) => db.collection(name);

  return {
    async init() {
      const { MongoClient } = await import("mongodb");
      client = new MongoClient(url);
      await client.connect();
      db = client.db(dbName);
      await ensureIndexes(db);
    },
    async find(name, filter) {
      return coll(name).find(sanitize(filter)).toArray();
    },
    async findOne(name, filter) {
      return coll(name).findOne(sanitize(filter));
    },
    async insertOne(name, doc) {
      const res = await coll(name).insertOne(doc);
      return { ...doc, _id: res.insertedId };
    },
    async findOneAndUpdate(name, filter, update) {
      const res = await coll(name).findOneAndUpdate(sanitize(filter), update, {
        returnDocument: "after",
      });
      // Driver v6 returns the doc directly (or null).
      return { doc: res ?? null, matched: Boolean(res) };
    },
    async updateOne(name, filter, update) {
      const res = await coll(name).updateOne(sanitize(filter), update);
      return { matched: res.matchedCount > 0, modified: res.modifiedCount };
    },
    async count(name, filter) {
      return coll(name).countDocuments(sanitize(filter));
    },
    async removeOne(name, filter) {
      const res = await coll(name).deleteOne(sanitize(filter));
      return { removed: res.deletedCount > 0 };
    },
    async close() {
      if (client) await client.close();
    },
  };
}

/** Mongo cannot use a JS Date string for $gt comparisons in all drivers; keep values as given. */
function sanitize(filter) {
  return filter;
}

async function ensureIndexes(db) {
  await db.collection("pantry_items").createIndex({ name: 1 }, { unique: true });
  await db.collection("plan_entries").createIndex(
    { date: 1, meal: 1 },
    { unique: true },
  );
  await db.collection("shopping_items").createIndex({ name: 1 });
  await db.collection("approvals").createIndex({ status: 1 });
  await db.collection("audit_log").createIndex({ at: 1 });
}
