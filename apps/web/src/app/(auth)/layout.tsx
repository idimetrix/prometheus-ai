export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-xl font-bold text-white">
            P
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-100">PROMETHEUS</h1>
          <p className="mt-1 text-sm text-zinc-500">AI Engineering Platform</p>
        </div>
        {children}
      </div>
    </div>
  );
}
