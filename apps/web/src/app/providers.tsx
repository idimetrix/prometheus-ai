"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { TRPCProvider } from "@/lib/trpc";
import { SocketProvider } from "@/providers/socket-provider";

export function Providers({ children }: { children: ReactNode }) {
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
