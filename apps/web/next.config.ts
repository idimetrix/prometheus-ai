import type { NextConfig } from "next";

const PROTOCOL_RE = /^https?:\/\//;

const socketHost = (
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4001"
).replace(PROTOCOL_RE, "");

/**
 * Content Security Policy for the web application.
 * Includes WebSocket and SSE connect-src directives.
 */
const cspDirectives = [
  "default-src 'self'",
  // Scripts: allow self + nonce-based inline
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  // Styles: allow self + inline (Next.js requires it)
  "style-src 'self' 'unsafe-inline'",
  // Images: allow self + data URIs + blob
  "img-src 'self' data: blob: https://*.clerk.com https://img.clerk.com",
  // Fonts
  "font-src 'self' data:",
  // Connect: API + WebSocket + SSE
  [
    "connect-src 'self'",
    // API server
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    "https://api.prometheus.dev",
    // WebSocket server
    `ws://${socketHost}`,
    `wss://${socketHost}`,
    "ws://*.prometheus.dev",
    "wss://*.prometheus.dev",
    // SSE endpoints (same as API)
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/events`,
    "https://api.prometheus.dev/events",
    // Clerk auth
    "https://*.clerk.com",
    "https://*.clerk.dev",
  ].join(" "),
  // Frame ancestors
  "frame-ancestors 'none'",
  // Form action
  "form-action 'self'",
  // Base URI
  "base-uri 'self'",
];

const ContentSecurityPolicy = cspDirectives.join("; ");

const nextConfig: NextConfig = {
  transpilePackages: [
    "@prometheus/ui",
    "@prometheus/types",
    "@prometheus/validators",
    "@prometheus/api",
  ],
  typedRoutes: true,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: ContentSecurityPolicy,
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ],
    },
  ],
};

export default nextConfig;
