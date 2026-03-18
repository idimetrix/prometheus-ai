import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@prometheus/ui",
    "@prometheus/types",
    "@prometheus/validators",
    "@prometheus/api",
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
