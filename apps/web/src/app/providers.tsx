"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ThemeProvider } from "next-themes";
import { TRPCProvider } from "@/lib/trpc";
import type { ReactNode } from "react";

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
        enableSystem
        disableTransitionOnChange
      >
        <TRPCProvider>{children}</TRPCProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
