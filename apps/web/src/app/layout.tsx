export const dynamic = "force-dynamic";
import type { Metadata } from "next";
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
