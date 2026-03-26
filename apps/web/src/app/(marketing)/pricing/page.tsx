"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

const TIERS = [
  {
    key: "hobby",
    name: "Hobby",
    monthlyPrice: 0,
    credits: 50,
    agents: 1,
    tasks: 10,
    features: [
      "50 credits/month",
      "1 parallel agent",
      "10 tasks/day",
      "Community support",
      "Public projects only",
      "Basic model routing",
    ],
    excluded: [
      "Fleet mode",
      "Custom models",
      "Priority queue",
      "SSO / SAML",
      "Audit logs",
      "Self-hosting",
    ],
    cta: "Get Started",
    ctaHref: "/sign-up" as Route,
    highlight: false,
  },
  {
    key: "starter",
    name: "Starter",
    monthlyPrice: 19,
    credits: 500,
    agents: 2,
    tasks: 50,
    features: [
      "500 credits/month",
      "2 parallel agents",
      "50 tasks/day",
      "Email support",
      "Private projects",
      "GitHub integration",
      "All model providers",
    ],
    excluded: [
      "Fleet mode",
      "Custom models",
      "Priority queue",
      "SSO / SAML",
      "Self-hosting",
    ],
    cta: "Start Free Trial",
    ctaHref: "/sign-up?plan=starter" as Route,
    highlight: false,
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 49,
    credits: 2000,
    agents: 4,
    tasks: 200,
    features: [
      "2,000 credits/month",
      "4 parallel agents",
      "200 tasks/day",
      "Priority support",
      "All integrations",
      "Custom models",
      "Project Brain",
      "Fleet mode",
      "Mixture-of-Agents (MoA)",
    ],
    excluded: ["SSO / SAML", "Audit logs", "Self-hosting"],
    cta: "Start Free Trial",
    ctaHref: "/sign-up?plan=pro" as Route,
    highlight: true,
  },
  {
    key: "team",
    name: "Team",
    monthlyPrice: 99,
    credits: 5000,
    agents: 8,
    tasks: 500,
    features: [
      "5,000 credits/month",
      "8 parallel agents",
      "500 tasks/day",
      "Dedicated support",
      "All Pro features",
      "Team collaboration",
      "Audit logs",
      "SSO / SAML",
      "Advanced analytics",
    ],
    excluded: ["Self-hosting", "On-premise deployment"],
    cta: "Start Free Trial",
    ctaHref: "/sign-up?plan=team" as Route,
    highlight: false,
  },
  {
    key: "studio",
    name: "Studio",
    monthlyPrice: 249,
    credits: 15_000,
    agents: 16,
    tasks: 1000,
    features: [
      "15,000 credits/month",
      "16 parallel agents",
      "1,000 tasks/day",
      "Top priority queue",
      "All Team features",
      "Self-hosting option",
      "Dedicated infrastructure",
      "Custom SLA",
      "White-glove onboarding",
    ],
    excluded: [],
    cta: "Start Free Trial",
    ctaHref: "/sign-up?plan=studio" as Route,
    highlight: false,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    monthlyPrice: null,
    credits: null,
    agents: null,
    tasks: null,
    features: [
      "Unlimited credits",
      "Unlimited parallel agents",
      "Unlimited tasks/day",
      "24/7 dedicated support",
      "All Studio features",
      "On-premise deployment",
      "Air-gapped environments",
      "Custom integrations",
      "Volume discounts",
      "Training and workshops",
    ],
    excluded: [],
    cta: "Contact Sales",
    ctaHref: "/about" as Route,
    highlight: false,
  },
];

const COMPARISON_FEATURES = [
  {
    name: "Monthly credits",
    hobby: "50",
    starter: "500",
    pro: "2,000",
    team: "5,000",
    studio: "15,000",
    enterprise: "Unlimited",
  },
  {
    name: "Parallel agents",
    hobby: "1",
    starter: "2",
    pro: "4",
    team: "8",
    studio: "16",
    enterprise: "Unlimited",
  },
  {
    name: "Tasks per day",
    hobby: "10",
    starter: "50",
    pro: "200",
    team: "500",
    studio: "1,000",
    enterprise: "Unlimited",
  },
  {
    name: "Private projects",
    hobby: false,
    starter: true,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "All model providers",
    hobby: false,
    starter: true,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Custom models",
    hobby: false,
    starter: false,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Fleet mode",
    hobby: false,
    starter: false,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Mixture-of-Agents",
    hobby: false,
    starter: false,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Project Brain",
    hobby: false,
    starter: false,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Priority queue",
    hobby: false,
    starter: false,
    pro: true,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Advanced analytics",
    hobby: false,
    starter: false,
    pro: false,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "SSO / SAML",
    hobby: false,
    starter: false,
    pro: false,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Audit logs",
    hobby: false,
    starter: false,
    pro: false,
    team: true,
    studio: true,
    enterprise: true,
  },
  {
    name: "Self-hosting",
    hobby: false,
    starter: false,
    pro: false,
    team: false,
    studio: true,
    enterprise: true,
  },
  {
    name: "On-premise / air-gapped",
    hobby: false,
    starter: false,
    pro: false,
    team: false,
    studio: false,
    enterprise: true,
  },
  {
    name: "Custom SLA",
    hobby: false,
    starter: false,
    pro: false,
    team: false,
    studio: true,
    enterprise: true,
  },
];

const FAQ_ITEMS = [
  {
    q: "What are credits?",
    a: "Credits are the units used to run AI agent tasks. Different task types cost different amounts: simple fixes use 5 credits, medium tasks use 25, and complex multi-agent builds use 75. Your plan includes a monthly credit allocation that resets each billing cycle.",
  },
  {
    q: "Can I buy additional credits?",
    a: "Yes. Credit packs are available as one-time purchases starting at $10 for 100 credits. Larger packs offer better per-credit pricing -- up to 50% savings on the 2,000-credit pack.",
  },
  {
    q: "What happens if I run out of credits?",
    a: "Your agents will pause until your credits reset at the start of your next billing cycle, or you purchase a credit pack. You will never be charged unexpectedly -- we notify you when credits are running low.",
  },
  {
    q: "How does the annual discount work?",
    a: "Annual billing saves you 20% compared to monthly pricing. You pay for 12 months upfront at the discounted rate. You can switch between monthly and annual billing at any time from your account settings.",
  },
  {
    q: "Can I change plans at any time?",
    a: "Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period so you keep your current plan benefits until then.",
  },
  {
    q: "What is Fleet mode?",
    a: "Fleet mode lets you run multiple agents in parallel on different tasks simultaneously. It is available on Pro and above. The number of parallel agents depends on your plan tier.",
  },
  {
    q: "Do you offer a free trial?",
    a: "The Hobby plan is free forever with 50 credits per month. For paid plans, we offer a 14-day free trial so you can experience the full feature set before committing.",
  },
  {
    q: "What is self-hosting?",
    a: "Studio and Enterprise plans can deploy PROMETHEUS on your own infrastructure. Your code, data, and AI interactions never leave your network. We support Docker, Kubernetes, and air-gapped environments.",
  },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "h-4 w-4 text-green-500"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="m4.5 12.75 6 6 9-13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "h-4 w-4 text-zinc-600"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="M6 18 18 6M6 6l12 12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  function getDisplayPrice(monthlyPrice: number | null): string {
    if (monthlyPrice === null) {
      return "Custom";
    }
    if (monthlyPrice === 0) {
      return "$0";
    }
    if (isAnnual) {
      const annual = Math.round(monthlyPrice * 0.8);
      return `$${annual}`;
    }
    return `$${monthlyPrice}`;
  }

  return (
    <div className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100 tracking-tight md:text-5xl">
            Simple, Transparent Pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-500">
            Start free, scale as you grow. No hidden fees, no surprises.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="mt-10 flex items-center justify-center gap-4">
          <span
            className={`font-medium text-sm ${isAnnual ? "text-zinc-500" : "text-zinc-100"}`}
          >
            Monthly
          </span>
          <button
            aria-label="Toggle annual billing"
            className={`relative h-7 w-12 rounded-full transition-colors ${
              isAnnual ? "bg-violet-600" : "bg-zinc-700"
            }`}
            onClick={() => setIsAnnual(!isAnnual)}
            type="button"
          >
            <div
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                isAnnual ? "translate-x-5.5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span
            className={`font-medium text-sm ${isAnnual ? "text-zinc-100" : "text-zinc-500"}`}
          >
            Annual
          </span>
          {isAnnual && (
            <span className="rounded-full border border-green-800/40 bg-green-900/30 px-2.5 py-0.5 font-medium text-green-400 text-xs">
              Save 20%
            </span>
          )}
        </div>

        {/* Pricing cards */}
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {TIERS.map((tier) => (
            <div
              className={`relative flex flex-col rounded-xl border p-6 ${
                tier.highlight
                  ? "border-violet-500 bg-violet-950/20 ring-1 ring-violet-500/30"
                  : "border-zinc-800 bg-zinc-900/30"
              }`}
              key={tier.key}
            >
              {tier.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-0.5 font-medium text-white text-xs">
                  Most Popular
                </div>
              )}
              <h3 className="font-semibold text-lg text-zinc-200">
                {tier.name}
              </h3>
              <div className="mt-4">
                {tier.monthlyPrice === null ? (
                  <div className="font-bold text-4xl text-zinc-100">Custom</div>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="font-bold text-4xl text-zinc-100">
                      {getDisplayPrice(tier.monthlyPrice)}
                    </span>
                    <span className="text-sm text-zinc-500">/mo</span>
                  </div>
                )}
              </div>
              {tier.monthlyPrice !== null &&
                tier.monthlyPrice > 0 &&
                isAnnual && (
                  <div className="mt-1 text-xs text-zinc-600 line-through">
                    ${tier.monthlyPrice}/mo
                  </div>
                )}
              <div className="mt-2 text-sm text-zinc-500">
                {tier.credits === null
                  ? "Unlimited credits"
                  : `${tier.credits.toLocaleString()} credits/mo`}
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li className="flex items-start gap-2 text-sm" key={feature}>
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span className="text-zinc-400">{feature}</span>
                  </li>
                ))}
                {tier.excluded.map((feature) => (
                  <li className="flex items-start gap-2 text-sm" key={feature}>
                    <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />
                    <span className="text-zinc-600">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                className={`mt-6 block w-full rounded-lg px-4 py-2.5 text-center font-medium text-sm transition-colors ${
                  tier.highlight
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                }`}
                href={tier.ctaHref}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="mt-24">
          <h2 className="text-center font-bold text-2xl text-zinc-100">
            Feature Comparison
          </h2>
          <p className="mt-2 text-center text-zinc-500">
            Detailed breakdown of what is included in each plan.
          </p>
          <div className="mt-10 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-zinc-800 border-b bg-zinc-900/80">
                  <th className="min-w-[180px] px-4 py-3 font-semibold text-zinc-300">
                    Feature
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-zinc-400">
                    Hobby
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-zinc-400">
                    Starter
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-violet-400">
                    Pro
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-zinc-400">
                    Team
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-zinc-400">
                    Studio
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-zinc-400">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((row) => (
                  <tr
                    className="border-zinc-800/50 border-b last:border-0"
                    key={row.name}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-400">
                      {row.name}
                    </td>
                    {(
                      [
                        "hobby",
                        "starter",
                        "pro",
                        "team",
                        "studio",
                        "enterprise",
                      ] as const
                    ).map((plan) => {
                      const value = row[plan];
                      let cell: React.ReactNode;
                      if (value === true) {
                        cell = (
                          <CheckIcon className="mx-auto h-4 w-4 text-green-500" />
                        );
                      } else if (value === false) {
                        cell = (
                          <XIcon className="mx-auto h-4 w-4 text-zinc-700" />
                        );
                      } else {
                        cell = (
                          <span
                            className={
                              plan === "pro"
                                ? "font-medium text-violet-300"
                                : "text-zinc-400"
                            }
                          >
                            {value}
                          </span>
                        );
                      }
                      return (
                        <td className="px-3 py-3 text-center" key={plan}>
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-24">
          <h2 className="text-center font-bold text-2xl text-zinc-100">
            Frequently Asked Questions
          </h2>
          <p className="mt-2 text-center text-zinc-500">
            Everything you need to know about PROMETHEUS pricing.
          </p>
          <div className="mx-auto mt-10 max-w-3xl space-y-3">
            {FAQ_ITEMS.map((item, idx) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30"
                key={item.q}
              >
                <button
                  className="flex w-full items-center justify-between px-6 py-4 text-left"
                  onClick={() =>
                    setExpandedFaq(expandedFaq === idx ? null : idx)
                  }
                  type="button"
                >
                  <span className="font-medium text-sm text-zinc-200">
                    {item.q}
                  </span>
                  <svg
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                      expandedFaq === idx ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {expandedFaq === idx && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-zinc-500 leading-relaxed">
                      {item.a}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-24 text-center">
          <h2 className="font-bold text-2xl text-zinc-100">
            Ready to build faster?
          </h2>
          <p className="mt-2 text-zinc-500">
            Start with 50 free credits. No credit card required.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              className="rounded-xl bg-violet-600 px-8 py-3.5 font-semibold text-sm text-white transition-colors hover:bg-violet-700"
              href={"/sign-up" as Route}
            >
              Get Started Free
            </Link>
            <Link
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-3.5 font-semibold text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
              href="/about"
            >
              Contact Sales
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
