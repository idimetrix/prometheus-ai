import { PRICING_TIERS } from "@prometheus/validators";

export default function PricingPage() {
  const tiers = Object.entries(PRICING_TIERS);

  return (
    <div className="container py-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Simple, Transparent Pricing</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free, scale as you grow. No hidden fees.
        </p>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tiers.map(([key, tier]) => (
          <div
            key={key}
            className={`rounded-xl border p-6 ${
              key === "pro" ? "border-primary ring-2 ring-primary/20 relative" : ""
            }`}
          >
            {key === "pro" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                Most Popular
              </div>
            )}
            <h3 className="text-lg font-semibold">{tier.name}</h3>
            <div className="mt-4">
              {tier.price !== null ? (
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">${(tier.price / 100).toFixed(0)}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
              ) : (
                <div className="text-4xl font-bold">Custom</div>
              )}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {tier.creditsIncluded !== null
                ? `${tier.creditsIncluded.toLocaleString()} credits/mo`
                : "Unlimited credits"}
            </div>
            <ul className="mt-6 space-y-2">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-green-500">+</span>
                  {feature}
                </li>
              ))}
            </ul>
            <button
              className={`mt-6 w-full rounded-lg px-4 py-2 text-sm font-medium ${
                key === "pro"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border hover:bg-muted"
              }`}
            >
              {tier.price === 0 ? "Get Started" : tier.price === null ? "Contact Sales" : "Subscribe"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-24 text-center">
        <h2 className="text-2xl font-bold">ROI Calculator</h2>
        <p className="mt-2 text-muted-foreground">
          See how much time and money PROMETHEUS can save you.
        </p>
        <div className="mt-8 mx-auto max-w-md rounded-lg border p-6 text-left">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Your hourly rate ($)</label>
              <input type="number" defaultValue={150} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">Hours saved per week</label>
              <input type="number" defaultValue={10} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div className="rounded-lg bg-muted p-4">
              <div className="text-sm text-muted-foreground">Monthly savings</div>
              <div className="text-2xl font-bold text-green-600">$6,000</div>
              <div className="mt-1 text-sm text-muted-foreground">1,100% ROI vs Pro plan</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
