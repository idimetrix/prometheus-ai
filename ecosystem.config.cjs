const path = require("path");
const fs = require("fs");

// Load .env file manually
const envFile = fs.readFileSync("/root/prometheus/.env", "utf-8");
const env = {};
envFile.split("\n").forEach((line) => {
  line = line.trim();
  if (!line || line.startsWith("#")) return;
  const idx = line.indexOf("=");
  if (idx === -1) return;
  const key = line.substring(0, idx);
  const val = line.substring(idx + 1);
  env[key] = val;
});

module.exports = {
  apps: [
    {
      name: "prometheus-web",
      cwd: "/root/prometheus/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { ...env, NODE_ENV: "production", PORT: 3000 },
    },
    {
      name: "prometheus-api",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/api/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-socket",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/socket-server/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-orchestrator",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/orchestrator/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-brain",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/project-brain/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-model-router",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/model-router/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-mcp-gateway",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/mcp-gateway/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-sandbox",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/sandbox-manager/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
    {
      name: "prometheus-worker",
      cwd: "/root/prometheus",
      script: "/usr/bin/tsx",
      args: "apps/queue-worker/src/index.ts",
      env: { ...env, NODE_ENV: "production" },
    },
  ],
};
