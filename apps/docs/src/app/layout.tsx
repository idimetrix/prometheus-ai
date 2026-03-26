import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prometheus Documentation",
  description: "Documentation for the Prometheus AI Engineering Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html className="dark" lang="en">
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <header className="mb-12">
            <a className="font-bold text-xl text-zinc-100" href="/">
              Prometheus <span className="text-violet-400">Docs</span>
            </a>
          </header>
          <main>{children}</main>
          <footer className="mt-16 border-zinc-800 border-t pt-8 text-sm text-zinc-600">
            Prometheus AI Engineering Platform
          </footer>
        </div>
      </body>
    </html>
  );
}
