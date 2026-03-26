"use client";

import type { AppRouter } from "@prometheus/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { type ReactNode, useState } from "react";
import superjson from "superjson";

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> =
  createTRPCReact<AppRouter>();

// API URL resolved fully at runtime — no process.env references to avoid Turbopack inlining
const _API_PORT = 4000;
const _API_FALLBACK = `http://localhost:${_API_PORT}`;

function getBaseUrl(): string {
  if (typeof document !== "undefined") {
    // Client-side: derive API URL from current page location
    const { hostname, protocol } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:${_API_PORT}`;
    }
    // Production: use meta tag or configured env (read at runtime via meta)
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="api-url"]'
    );
    if (meta?.content) {
      return meta.content;
    }
  }
  return _API_FALLBACK;
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    // Clerk exposes __clerk_db_jwt or we use the Clerk client
    const { default: _clerk } = await import("@clerk/nextjs");
    const session = (
      window as unknown as {
        Clerk?: { session?: { getToken: () => Promise<string> } };
      }
    ).Clerk?.session;
    if (session) {
      return await session.getToken();
    }
  } catch {
    // Clerk not loaded yet
  }

  // Dev auth bypass — read from meta tag to avoid Turbopack compile-time inlining
  const devBypassMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="dev-auth-bypass"]'
  );
  if (devBypassMeta?.content === "true") {
    return "dev_token_usr_seed_dev001__org_seed_dev001";
  }

  return null;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              if (error instanceof Error && "status" in error) {
                const status = (error as { status?: number }).status;
                if (status && status >= 400 && status < 500) {
                  return false;
                }
              }
              return failureCount < 3;
            },
          },
          mutations: {
            retry: (failureCount, error) => {
              if (error instanceof Error && "status" in error) {
                const status = (error as { status?: number }).status;
                if (status && status >= 400 && status < 500) {
                  return false;
                }
              }
              return failureCount < 2;
            },
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/trpc`,
          transformer: superjson,
          async headers() {
            const token = await getAuthToken();
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
