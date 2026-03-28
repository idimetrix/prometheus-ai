import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@prometheus/ui";
import { Check, Minus, Zap } from "lucide-react";
import Link from "next/link";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get started with AI-powered engineering.",
    cta: "Get Started",
    ctaHref: "/sign-up",
    highlighted: false,
    features: [
      "1 project",
      "50 tasks / month",
      "Community models (Ollama)",
      "Basic code search",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$29",
    period: "per user / month",
    description: "For individual developers and small teams.",
    cta: "Subscribe",
    ctaHref: "/sign-up?plan=pro",
    highlighted: true,
    features: [
      "Unlimited projects",
      "2,000 tasks / month",
      "Premium models (Claude, GPT-4o)",
      "Semantic code search",
      "GitHub/GitLab integration",
      "Custom agent roles",
      "Priority support",
    ],
  },
  {
    name: "Team",
    price: "$79",
    period: "per user / month",
    description: "For growing engineering teams.",
    cta: "Subscribe",
    ctaHref: "/sign-up?plan=team",
    highlighted: false,
    features: [
      "Everything in Pro",
      "10,000 tasks / month",
      "Multi-agent orchestration",
      "Fleet management",
      "RBAC & audit logs",
      "Slack & Discord notifications",
      "SSO (SAML/OIDC)",
      "Dedicated support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    description: "For large organizations with custom needs.",
    cta: "Contact Sales",
    ctaHref: "mailto:sales@prometheus.dev",
    highlighted: false,
    features: [
      "Everything in Team",
      "Unlimited tasks",
      "Self-hosted deployment",
      "Custom model routing",
      "SLA guarantee",
      "SOC 2 compliance",
      "Dedicated account manager",
      "Custom integrations",
    ],
  },
] as const;

interface ComparisonRow {
  enterprise: string | boolean;
  feature: string;
  free: string | boolean;
  pro: string | boolean;
  team: string | boolean;
}

const COMPARISON: ComparisonRow[] = [
  {
    feature: "Projects",
    free: "1",
    pro: "Unlimited",
    team: "Unlimited",
    enterprise: "Unlimited",
  },
  {
    feature: "Tasks per month",
    free: "50",
    pro: "2,000",
    team: "10,000",
    enterprise: "Unlimited",
  },
  {
    feature: "Premium LLM models",
    free: false,
    pro: true,
    team: true,
    enterprise: true,
  },
  {
    feature: "Semantic search",
    free: false,
    pro: true,
    team: true,
    enterprise: true,
  },
  {
    feature: "Multi-agent orchestration",
    free: false,
    pro: false,
    team: true,
    enterprise: true,
  },
  {
    feature: "Fleet management",
    free: false,
    pro: false,
    team: true,
    enterprise: true,
  },
  {
    feature: "SSO (SAML/OIDC)",
    free: false,
    pro: false,
    team: true,
    enterprise: true,
  },
  {
    feature: "Audit logs",
    free: false,
    pro: false,
    team: true,
    enterprise: true,
  },
  {
    feature: "Self-hosted deployment",
    free: false,
    pro: false,
    team: false,
    enterprise: true,
  },
  {
    feature: "SLA guarantee",
    free: false,
    pro: false,
    team: false,
    enterprise: true,
  },
  {
    feature: "Support",
    free: "Community",
    pro: "Priority",
    team: "Dedicated",
    enterprise: "Custom",
  },
];

const FAQS = [
  {
    q: "Can I change plans at any time?",
    a: "Yes. You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle. Prorated credits are applied automatically.",
  },
  {
    q: "What counts as a task?",
    a: "A task is any request that involves an AI agent performing work: implementing a feature, fixing a bug, writing tests, reviewing code, etc. Simple queries and searches do not count.",
  },
  {
    q: "Do you offer a free trial?",
    a: "The Free tier is available indefinitely. For Pro and Team, we offer a 14-day free trial with full access to all features.",
  },
  {
    q: "What LLM models are available?",
    a: "Free tier uses community models via Ollama. Pro and above get access to Claude, GPT-4o, Gemini, and other premium models. Enterprise plans support BYO model keys and custom routing.",
  },
  {
    q: "Is my code stored or used for training?",
    a: "Your code is only processed ephemerally for task completion. We never store your code beyond the active session, and it is never used for model training.",
  },
];

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-green-500" />
    ) : (
      <Minus className="mx-auto h-4 w-4 text-muted-foreground" />
    );
  }
  return <span className="text-sm">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link className="font-bold text-foreground text-xl" href="/">
            Prometheus
          </Link>
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost">
              <a href="/sign-in">Sign In</a>
            </Button>
            <Button asChild>
              <a href="/sign-up">Get Started</a>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* Hero */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-foreground tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Start free, scale as you grow. No hidden fees, no surprises.
          </p>
        </div>

        {/* Tier Cards */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <Card
              className={
                tier.highlighted ? "border-primary shadow-lg" : undefined
              }
              key={tier.name}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{tier.name}</CardTitle>
                  {tier.highlighted && (
                    <Badge>
                      <Zap className="mr-1 h-3 w-3" />
                      Popular
                    </Badge>
                  )}
                </div>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="font-bold text-3xl text-foreground">
                    {tier.price}
                  </span>
                  <span className="ml-1 text-muted-foreground text-sm">
                    {tier.period}
                  </span>
                </div>

                <Button
                  asChild
                  className="w-full"
                  variant={tier.highlighted ? "default" : "outline"}
                >
                  <a href={tier.ctaHref}>{tier.cta}</a>
                </Button>

                <Separator className="my-6" />

                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li className="flex items-start gap-2" key={feature}>
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span className="text-muted-foreground text-sm">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Comparison Table */}
        <div className="mt-24">
          <h2 className="text-center font-bold text-2xl text-foreground">
            Feature Comparison
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th className="pr-4 pb-3 font-medium text-muted-foreground text-sm">
                    Feature
                  </th>
                  <th className="pb-3 text-center font-medium text-muted-foreground text-sm">
                    Free
                  </th>
                  <th className="pb-3 text-center font-medium text-muted-foreground text-sm">
                    Pro
                  </th>
                  <th className="pb-3 text-center font-medium text-muted-foreground text-sm">
                    Team
                  </th>
                  <th className="pb-3 text-center font-medium text-muted-foreground text-sm">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr className="border-b" key={row.feature}>
                    <td className="py-3 pr-4 text-foreground text-sm">
                      {row.feature}
                    </td>
                    <td className="py-3 text-center">
                      <CellValue value={row.free} />
                    </td>
                    <td className="py-3 text-center">
                      <CellValue value={row.pro} />
                    </td>
                    <td className="py-3 text-center">
                      <CellValue value={row.team} />
                    </td>
                    <td className="py-3 text-center">
                      <CellValue value={row.enterprise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-24">
          <h2 className="text-center font-bold text-2xl text-foreground">
            Frequently Asked Questions
          </h2>
          <div className="mx-auto mt-8 max-w-3xl space-y-6">
            {FAQS.map((faq) => (
              <div key={faq.q}>
                <h3 className="font-semibold text-foreground">{faq.q}</h3>
                <p className="mt-2 text-muted-foreground text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
