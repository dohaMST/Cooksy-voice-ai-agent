#!/usr/bin/env node
/**
 * Re-point openclaw/openclaw.patch.json5 at wherever this repo actually lives.
 *
 * The patch carries four absolute paths (two agent workspaces, the MCP server
 * entry point, the skills folder). OpenClaw's config validator rejects the patch
 * if they do not exist, so a clone in a different folder could not apply it.
 *
 * Run once after cloning, before `openclaw config patch`:
 *
 *   node scripts/localize-openclaw.mjs          # rewrite in place
 *   node scripts/localize-openclaw.mjs --check  # exit 1 if it needs rewriting
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATCH = join(ROOT, "openclaw", "openclaw.patch.json5");
const ROOT_POSIX = ROOT.replaceAll("\\", "/");

/** The four absolute paths the patch points inside this repo. */
const SUFFIXES = [
  "/openclaw/agents/cook",
  "/openclaw/agents/planner",
  "/api/mcp-server.mjs",
  "/openclaw/skills",
];

const checkOnly = process.argv.includes("--check");

let text = await readFile(PATCH, "utf8");
let rewritten = 0;

for (const suffix of SUFFIXES) {
  const escaped = suffix.replaceAll(".", "\\.");
  // An absolute path (drive letter or leading slash) ending in this suffix.
  const pattern = new RegExp(`"((?:[A-Za-z]:/|/)[^"\\n]*?${escaped})"`, "g");
  text = text.replace(pattern, (match, found) => {
    if (found === `${ROOT_POSIX}${suffix}`) return match;
    rewritten += 1;
    return `"${ROOT_POSIX}${suffix}"`;
  });
}

if (!rewritten) {
  console.log(`openclaw patch already points at ${ROOT_POSIX}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `openclaw patch has ${rewritten} path(s) outside this checkout. Run: node scripts/localize-openclaw.mjs`,
  );
  process.exit(1);
}

await writeFile(PATCH, text, "utf8");
console.log(`openclaw patch updated: ${rewritten} path(s) now point at ${ROOT_POSIX}`);
