import { readFileSync } from "node:fs";
const c = JSON.parse(readFileSync(new URL("../cooksy-tools.json", import.meta.url), "utf8"));
const read = c.tools.filter((t) => !t.gated);
const gated = c.tools.filter((t) => t.gated);
console.log("tools:", c.tools.length, "read:", read.length, "gated:", gated.length);
console.log("read:", read.map((t) => t.name).join(", "));
console.log("gated:", gated.map((t) => t.name).join(", "));
