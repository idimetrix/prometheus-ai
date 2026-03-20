"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useEffect } from "react";
import { TRPCProvider } from "@/lib/trpc";
import { SocketProvider } from "@/providers/socket-provider";

/**
 * AI SDK 6 DevTools — enabled only in development mode.
 * Provides real-time visibility into agent steps, tool calls, and token usage
 * at localhost:4983 when running locally.
 */
function useAiSdkDevTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    let cleanup: (() => void) | undefined;

    // @ts-expect-error — @ai-sdk/devtools is an optional dev dependency
    import("@ai-sdk/devtools")
      .then((mod: { enableDevTools?: () => () => void }) => {
        if (mod.enableDevTools) {
          cleanup = mod.enableDevTools();
        }
      })
      .catch(() => {
        // DevTools package not installed — skip silently in dev
      });

    return () => {
      cleanup?.();
    };
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  useAiSdkDevTools();

  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#8b5cf6",
          colorBackground: "#09090b",
          colorText: "#fafafa",
        },
      }}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        enableSystem
      >
        <TRPCProvider>
          <SocketProvider>{children}</SocketProvider>
        </TRPCProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
