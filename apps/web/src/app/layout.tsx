import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "PROMETHEUS - AI Engineering Platform",
  description:
    "The AI engineering platform that builds your entire project from requirements to production deployment.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html className="dark" lang="en" suppressHydrationWarning>
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
