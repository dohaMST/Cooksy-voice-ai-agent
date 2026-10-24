/**
 * In-memory store. Used by the unit tests and by an explicit
 * `COOKSY_STORE=memory` run. This is a real store with real semantics, not a
 * mock and not seeded demo data — the collections start empty.
 *
 * `matches` supports exactly what the gate and the executors use: equality,
 * $gt / $gte / $lt / $lte, $in, and whole-array contains. An unknown operator
 * THROWS rather than being ignored, because silently ignoring one would make a
 * range filter match every document — the plan query would look like it worked.
 */

const RANGE_OPS = {
  $gt: (value, operand) => value > operand,
  $gte: (value, operand) => value >= operand,
  $lt: (value, operand) => value < operand,
  $lte: (value, operand) => value <= operand,
};

export function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];

    if (Array.isArray(cond)) {
      const docValue = Array.isArray(value) ? value : [];
      if (!cond.every((v) => docValue.includes(v))) return false;
      continue;
    }

    if (cond !== null && typeof cond === "object") {
      for (const [op, operand] of Object.entries(cond)) {
        if (op === "$in") {
          if (!operand.includes(value)) return false;
        } else if (op in RANGE_OPS) {
          if (!RANGE_OPS[op](value, operand)) return false;
        } else {
          throw new Error(`Unsupported filter operator "${op}" on field "${key}".`);
        }
      }
      continue;
    }

    if (value !== cond) return false;
  }
  return true;
}

function applyUpdate(doc, update) {
  const unknown = Object.keys(update).filter((k) => k !== "$set");
  if (unknown.length) {
    throw new Error(`Unsupported update operator(s): ${unknown.join(", ")}`);
  }
  return { ...doc, ...(update.$set ?? {}) };
}

export function createMemoryStore() {
  /** @type {Map<string, object[]>} */
  const data = new Map();
  let idCounter = 0;

  const coll = (name) => {
    if (!data.has(name)) data.set(name, []);
    return data.get(name);
  };

  const withId = (doc) =>
    doc._id !== undefined
      ? { ...doc }
      : { _id: `mem_${(++idCounter).toString(36)}_${Date.now().toString(36)}`, ...doc };

  return {
    kind: "memory",
    async init() {},
    async find(name, filter = {}) {
      return coll(name).filter((d) => matches(d, filter)).map((d) => ({ ...d }));
    },
    async findOne(name, filter) {
      const hit = coll(name).find((d) => matches(d, filter));
      return hit ? { ...hit } : null;
    },
    async insertOne(name, doc) {
      const stored = withId(doc);
      coll(name).push(stored);
      return { ...stored };
    },
    async findOneAndUpdate(name, filter, update) {
      const list = coll(name);
      // findIndex + replace is atomic here: Node runs the synchronous body of
      // this call to completion before any other task can interleave.
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { doc: null, matched: false };
      list[idx] = applyUpdate(list[idx], update);
      return { doc: { ...list[idx] }, matched: true };
    },
    async updateOne(name, filter, update) {
      const list = coll(name);
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { matched: false, modified: 0 };
      list[idx] = applyUpdate(list[idx], update);
      return { matched: true, modified: 1 };
    },
    async removeOne(name, filter) {
      const list = coll(name);
      const idx = list.findIndex((d) => matches(d, filter));
      if (idx === -1) return { removed: false };
      list.splice(idx, 1);
      return { removed: true };
    },
    async count(name, filter = {}) {
      return coll(name).filter((d) => matches(d, filter)).length;
    },
    async close() {
      data.clear();
    },
  };
}
