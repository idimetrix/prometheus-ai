export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="text-xl font-bold">PROMETHEUS</div>
          <nav className="flex items-center gap-6">
            <a href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
              Pricing
            </a>
            <a href="/sign-in" className="text-sm font-medium">
              Sign In
            </a>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t py-8">
        <div className="container text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} PROMETHEUS. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
