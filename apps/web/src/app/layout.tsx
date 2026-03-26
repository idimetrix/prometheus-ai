export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "PROMETHEUS - AI Engineering Platform",
  description:
    "The AI engineering platform that builds your entire project from requirements to production deployment.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html className="dark" lang="en" suppressHydrationWarning>
      <head>
        <link href="/manifest.json" rel="manifest" />
        <meta content="#7c3aed" name="theme-color" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content={process.env.NEXT_PUBLIC_API_URL ?? ""} name="api-url" />
        <meta
          content={process.env.NEXT_PUBLIC_SOCKET_URL ?? ""}
          name="socket-url"
        />
        <meta
          content={process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS ?? "false"}
          name="dev-auth-bypass"
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "hsl(var(--color-card))",
              border: "1px solid hsl(var(--color-border))",
              color: "hsl(var(--color-foreground))",
            },
          }}
        />
      </body>
    </html>
  );
}
