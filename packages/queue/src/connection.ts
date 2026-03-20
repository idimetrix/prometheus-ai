import IORedis, { type Cluster } from "ioredis";

function createClusterConnection(): Cluster {
  const clusterNodes = process.env.REDIS_CLUSTER_NODES;
  if (!clusterNodes) {
    throw new Error("REDIS_CLUSTER_NODES is required for cluster mode");
  }

  const nodes = clusterNodes.split(",").map((h) => {
    const [host, port] = h.split(":");
    return { host: host ?? "localhost", port: Number(port ?? 6379) };
  });

  return new IORedis.Cluster(nodes, {
    redisOptions: {
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    },
    scaleReads: "slave",
    natMap: process.env.REDIS_CLUSTER_NAT_MAP
      ? (JSON.parse(process.env.REDIS_CLUSTER_NAT_MAP) as Record<
          string,
          { host: string; port: number }
        >)
      : undefined,
  });
}

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
  if (process.env.REDIS_CLUSTER_NODES) {
    // Cluster is API-compatible with IORedis for most operations
    return createClusterConnection() as unknown as IORedis;
  }
  if (process.env.REDIS_SENTINEL_HOSTS) {
    return createSentinelConnection();
  }
  return createStandardConnection();
}

export const redis = createRedisConnection();
