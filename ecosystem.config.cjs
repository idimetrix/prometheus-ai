"use strict";
const fs = require("node:fs");

// Load .env file manually
const envFile = fs.readFileSync("/root/prometheus/.env", "utf-8");
const env = {};
for (const rawLine of envFile.split("\n")) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    continue;
  }
  const idx = trimmed.indexOf("=");
  if (idx === -1) {
    continue;
  }
  const key = trimmed.slice(0, idx);
  const val = trimmed.slice(idx + 1);
  env[key] = val;
}

const commonOpts = {
  max_memory_restart: "2G",
  restart_delay: 3000,
  max_restarts: 10,
  merge_logs: true,
};

const tsxService = (name, entryPath, extraEnv = {}) => ({
  name,
  cwd: "/root/prometheus",
  script: "/usr/bin/tsx",
  args: entryPath,
  env: { ...env, NODE_ENV: "production", ...extraEnv },
  out_file: `/root/prometheus/logs/${name.replace("prometheus-", "")}-out.log`,
  error_file: `/root/prometheus/logs/${name.replace("prometheus-", "")}-error.log`,
  ...commonOpts,
});

module.exports = {
  apps: [
    {
      name: "prometheus-web",
      cwd: "/root/prometheus/apps/web/.next/standalone/apps/web",
      script: "server.js",
      env: { ...env, NODE_ENV: "production", PORT: 3000, HOSTNAME: "0.0.0.0" },
      out_file: "/root/prometheus/logs/web-out.log",
      error_file: "/root/prometheus/logs/web-error.log",
      ...commonOpts,
    },
    tsxService("prometheus-api", "apps/api/src/index.ts"),
    tsxService("prometheus-socket", "apps/socket-server/src/index.ts"),
    tsxService("prometheus-orchestrator", "apps/orchestrator/src/index.ts"),
    tsxService("prometheus-brain", "apps/project-brain/src/index.ts"),
    tsxService("prometheus-model-router", "apps/model-router/src/index.ts"),
    tsxService("prometheus-mcp-gateway", "apps/mcp-gateway/src/index.ts"),
    tsxService("prometheus-sandbox", "apps/sandbox-manager/src/index.ts", {
      SANDBOX_MODE: "dev",
    }),
    tsxService("prometheus-worker", "apps/queue-worker/src/index.ts"),
  ],
};
