/**
 * MongoDB store — the shipped store for `COOKSY_STORE=mongo`.
 *
 * The driver is imported lazily so the unit tests and a memory-mode run never
 * need it installed, or a server reachable.
 *
 * Deliberately NO TTL index on approvals.expiresAt. A TTL index would delete a
 * pending approval the moment it aged out, which silently destroys the record
 * before its outcome (approved / denied / expired) is ever written. Expiry is
 * instead resolved by the API's sweeper and the gate's on-read check, both of
 * which mark the row `expired` and write an audit entry.
 */
import { MongoClient } from "mongodb";

export function createMongoStore({ url, dbName = "cooksy" }) {
  let client = null;
  let db = null;
  const coll = (name) => {
    if (!db) throw new Error("Store not initialised. Call init() first.");
    return db.collection(name);
  };

  return {
    kind: "mongo",

    async init() {
      client = new MongoClient(url, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      db = client.db(dbName);

      // Fail loud: a reachable socket with bad credentials should not look
      // like a working store.
      try {
        await db.command({ ping: 1 });
      } catch (cause) {
        await client.close().catch(() => {});
        throw new Error(`MongoDB at ${redact(url)} did not answer ping: ${cause.message}`);
      }
      await ensureIndexes(db);
    },

    async find(name, filter = {}) {
      return coll(name).find(filter).toArray();
    },

    async findOne(name, filter) {
      return coll(name).findOne(filter);
    },

    async insertOne(name, doc) {
      const { _id, ...rest } = doc;
      // Preserve a caller-supplied string _id (approvals use `act_...`);
      // otherwise let Mongo mint an ObjectId.
      const toInsert = _id === undefined ? rest : { _id, ...rest };
      const res = await coll(name).insertOne(toInsert);
      return { ...toInsert, _id: toInsert._id ?? res.insertedId };
    },

    async findOneAndUpdate(name, filter, update) {
      const res = await coll(name).findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
      if (res == null) return { doc: null, matched: false };
      // Driver v5 wraps the doc in metadata ({ value, lastErrorObject });
      // v6 returns the document itself. Discriminate on the metadata field.
      const doc = "lastErrorObject" in res ? res.value : res;
      return { doc: doc ?? null, matched: doc != null };
    },

    async updateOne(name, filter, update) {
      const res = await coll(name).updateOne(filter, update);
      return { matched: res.matchedCount > 0, modified: res.modifiedCount };
    },

    async removeOne(name, filter) {
      const res = await coll(name).deleteOne(filter);
      return { removed: res.deletedCount > 0 };
    },

    async count(name, filter = {}) {
      return coll(name).countDocuments(filter);
    },

    async close() {
      if (client) await client.close();
      client = null;
      db = null;
    },
  };
}

async function ensureIndexes(db) {
  await db.collection("pantry_items").createIndex({ name: 1 }, { unique: true });
  await db.collection("plan_entries").createIndex({ date: 1, meal: 1 }, { unique: true });
  await db.collection("shopping_items").createIndex({ name: 1 });

  // Plain indexes only. An index named *_ttl_* must never appear here — see the
  // module comment: TTL deletion would erase pending approvals before audit.
  await db.collection("approvals").createIndex({ status: 1 });
  await db.collection("approvals").createIndex({ expiresAt: 1 });

  await db.collection("audit_log").createIndex({ at: 1 });
  await db.collection("audit_log").createIndex({ approvalId: 1 });
}

/** Never put a password in a log line. */
export function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable mongo url>";
  }
}
