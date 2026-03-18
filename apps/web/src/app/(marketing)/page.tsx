export default function HomePage() {
  return (
    <div className="container py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">
        The AI Engineering Platform
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        12 specialist AI agents that build your entire project — from requirements to production deployment — without you babysitting.
      </p>
      <div className="mt-10 flex justify-center gap-4">
        <a
          href="/sign-up"
          className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-medium text-white hover:bg-brand-700"
        >
          Get Started Free
        </a>
        <a
          href="#features"
          className="rounded-lg border px-6 py-3 text-sm font-medium hover:bg-muted"
        >
          Learn More
        </a>
      </div>
    </div>
  );
}
