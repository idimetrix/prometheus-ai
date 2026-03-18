import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@prometheus/ui", "@prometheus/types", "@prometheus/validators"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
