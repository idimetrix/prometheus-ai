import IORedis from "ioredis";

function createSentinelConnection(): IORedis {
  const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS;
  if (!sentinelHosts) {
    throw new Error("REDIS_SENTINEL_HOSTS is required for sentinel mode");
  }

  const sentinels = sentinelHosts.split(",").map((h) => {
    const [host, port] = h.split(":");
    return { host: host ?? "localhost", port: Number(port ?? 26_379) };
  });

  return new IORedis({
    sentinels,
    name: process.env.REDIS_SENTINEL_MASTER ?? "prometheus-primary",
    password: process.env.REDIS_PASSWORD,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

function createStandardConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function createRedisConnection(): IORedis {
  if (process.env.REDIS_SENTINEL_HOSTS) {
    return createSentinelConnection();
  }
  return createStandardConnection();
}

export const redis = createRedisConnection();
