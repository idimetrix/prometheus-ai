"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

const TIERS = [
  {
    key: "hobby",
    name: "Hobby",
    price: 0,
    credits: 50,
    agents: 1,
    tasks: 5,
    features: [
      "50 credits/month",
      "1 parallel agent",
      "5 tasks/day",
      "Community support",
      "Public projects only",
    ],
    cta: "Get Started",
    highlight: false,
  },
  {
    key: "starter",
    name: "Starter",
    price: 29,
    credits: 500,
    agents: 3,
    tasks: 25,
    features: [
      "500 credits/month",
      "3 parallel agents",
      "25 tasks/day",
      "Email support",
      "Private projects",
      "GitHub integration",
    ],
    cta: "Subscribe",
    highlight: false,
  },
  {
    key: "pro",
    name: "Pro",
    price: 99,
    credits: 2500,
    agents: 10,
    tasks: 100,
    features: [
      "2,500 credits/month",
      "10 parallel agents",
      "100 tasks/day",
      "Priority support",
      "All integrations",
      "Custom models",
      "Project Brain",
      "Fleet mode",
    ],
    cta: "Subscribe",
    highlight: true,
  },
  {
    key: "team",
    name: "Team",
    price: 299,
    credits: 10_000,
    agents: 25,
    tasks: 500,
    features: [
      "10,000 credits/month",
      "25 parallel agents",
      "500 tasks/day",
      "Dedicated support",
      "All Pro features",
      "Team collaboration",
      "Audit logs",
      "SSO / SAML",
    ],
    cta: "Subscribe",
    highlight: false,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: null,
    credits: null,
    agents: null,
    tasks: null,
    features: [
      "Unlimited credits",
      "Unlimited agents",
      "Self-hosted option",
      "Dedicated infrastructure",
      "Custom SLA",
      "On-premise deployment",
      "White-glove onboarding",
    ],
    cta: "Contact Sales",
    highlight: false,
  },
];

export default function PricingPage() {
  const [hourlyRate, setHourlyRate] = useState(150);
  const [hoursSaved, setHoursSaved] = useState(10);
  const monthlySavings = hourlyRate * hoursSaved * 4;

  return (
    <div className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100">
            Simple, Transparent Pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-500">
            Start free, scale as you grow. No hidden fees.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {TIERS.map((tier) => (
            <div
              className={`relative rounded-xl border p-6 ${
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
                {tier.price === null ? (
                  <div className="font-bold text-4xl text-zinc-100">Custom</div>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="font-bold text-4xl text-zinc-100">
                      ${tier.price}
                    </span>
                    <span className="text-sm text-zinc-500">/mo</span>
                  </div>
                )}
              </div>
              <div className="mt-2 text-sm text-zinc-500">
                {tier.credits === null
                  ? "Unlimited"
                  : `${tier.credits.toLocaleString()} credits/mo`}
              </div>

              <ul className="mt-6 space-y-2.5">
                {tier.features.map((feature, i) => (
                  <li className="flex items-start gap-2 text-sm" key={i}>
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
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
                    <span className="text-zinc-400">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                className={`mt-6 block w-full rounded-lg px-4 py-2.5 text-center font-medium text-sm transition-colors ${
                  tier.highlight
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                }`}
                href={(tier.price === null ? "/about" : "/sign-up") as Route}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* ROI Calculator */}
        <div className="mt-24 text-center">
          <h2 className="font-bold text-2xl text-zinc-100">ROI Calculator</h2>
          <p className="mt-2 text-zinc-500">
            See how much time and money PROMETHEUS can save you.
          </p>
          <div className="mx-auto mt-8 max-w-md rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
            <div className="space-y-4">
              <div>
                <label
                  className="font-medium text-sm text-zinc-300"
                  htmlFor="hourly-rate"
                >
                  Your hourly rate ($)
                </label>
                <input
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
                  id="hourly-rate"
                  onChange={(e) => setHourlyRate(Number(e.target.value) || 0)}
                  type="number"
                  value={hourlyRate}
                />
              </div>
              <div>
                <label
                  className="font-medium text-sm text-zinc-300"
                  htmlFor="hours-saved"
                >
                  Hours saved per week
                </label>
                <input
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
                  id="hours-saved"
                  onChange={(e) => setHoursSaved(Number(e.target.value) || 0)}
                  type="number"
                  value={hoursSaved}
                />
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-xs text-zinc-500">Monthly savings</div>
                <div className="mt-1 font-bold text-3xl text-green-400">
                  ${monthlySavings.toLocaleString()}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {monthlySavings > 99
                    ? `${Math.round(((monthlySavings - 99) / 99) * 100)}% ROI vs Pro plan`
                    : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
