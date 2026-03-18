"use client";

import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { useState, type ReactNode } from "react";
import type { AppRouter } from "@prometheus/api";

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  }
  return process.env.API_URL ?? "http://localhost:4000";
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    // Clerk exposes __clerk_db_jwt or we use the Clerk client
    const { default: clerk } = await import("@clerk/nextjs");
    // @ts-expect-error -- accessing clerk singleton at runtime
    const session = window.Clerk?.session;
    if (session) {
      return await session.getToken();
    }
  } catch {
    // Clerk not loaded yet
  }
  return null;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
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
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
