/**
 * Single source of configuration for cooksy-api.
 *
 * Fails loud at boot: a missing, placeholder or too-short secret stops the
 * process immediately, instead of surfacing later as a mysterious 401 or a
 * half-configured server. Nothing else in the codebase reads process.env.
 */

const PLACEHOLDER = /^(change_?me|changeme|your[-_]?.*|secret|test|todo|xxx+)$/i;
const MIN_SECRET_LEN = 32;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(env, name, { fallback, min = 1 } = {}) {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : raw;
  if (value === undefined) {
    throw new ConfigError(`${name} is required but not set.`);
  }
  if (typeof value === "string" && PLACEHOLDER.test(value.trim())) {
    throw new ConfigError(`${name} is still a placeholder value.`);
  }
  if (typeof value === "string" && value.length < min) {
    throw new ConfigError(`${name} must be at least ${min} characters.`);
  }
  return value;
}

/**
 * Build the runtime config. Pass an env object explicitly in tests.
 * @param {Record<string, string|undefined>} env
 */
export function loadConfig(env = process.env) {
  const store = read(env, "COOKSY_STORE", { fallback: "mongo" });
  if (store !== "mongo" && store !== "memory") {
    throw new ConfigError(`COOKSY_STORE must be "mongo" or "memory", got "${store}".`);
  }

  const agentToken = read(env, "COOKSY_API_TOKEN", { min: MIN_SECRET_LEN });
  const approverToken = read(env, "COOKSY_APPROVER_TOKEN", { min: MIN_SECRET_LEN });

  // The whole two-credential gate collapses if these are the same value.
  if (agentToken === approverToken) {
    throw new ConfigError(
      "COOKSY_API_TOKEN and COOKSY_APPROVER_TOKEN must be different values.",
    );
  }

  const port = Number(read(env, "COOKSY_API_PORT", { fallback: "4010" }));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`COOKSY_API_PORT is not a valid port: ${port}.`);
  }

  const config = {
    port,
    store,
    agentToken,
    approverToken,
    dataDir: read(env, "COOKSY_DATA_DIR", { fallback: "data" }),
    mongo: null,
  };

  if (store === "mongo") {
    const url = read(env, "MONGO_URL");
    if (!/^mongodb(\+srv)?:\/\//.test(url)) {
      throw new ConfigError("MONGO_URL must start with mongodb:// or mongodb+srv://");
    }
    const password = new URL(url).password ?? "";
    if (password === "") {
      throw new ConfigError("MONGO_URL must include a password for the cooksy user.");
    }
    if (PLACEHOLDER.test(password)) {
      throw new ConfigError("MONGO_URL still contains the CHANGE_ME password.");
    }
    config.mongo = { url, dbName: read(env, "MONGO_DB", { fallback: "cooksy" }) };
  }

  return config;
}

export { MIN_SECRET_LEN };
