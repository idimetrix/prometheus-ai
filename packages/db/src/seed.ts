/**
 * Database seed script for development.
 * Usage: pnpm db:seed (or tsx packages/db/src/seed.ts)
 *
 * Creates sample data for local development:
 * - 1 organization with hobby plan
 * - 1 user
 * - 2 projects with settings
 * - Credit balance
 * - Subscription plan definitions
 * - Tech stack presets
 */

import { db } from "./client";
import {
  organizations, users, orgMembers, projects, projectSettings,
  projectMembers, creditBalances, subscriptionPlans, techStackPresets,
} from "./schema";

const ORG_ID = "org_seed_dev001";
const USER_ID = "usr_seed_dev001";
const CLERK_ID = "user_dev_clerk";

async function seed() {
  console.log("Seeding database...");

  // Organization
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Dev Organization",
    slug: "dev-org",
    planTier: "pro",
  }).onConflictDoNothing();

  // User
  await db.insert(users).values({
    id: USER_ID,
    clerkId: CLERK_ID,
    email: "dev@prometheus.local",
    name: "Dev User",
  }).onConflictDoNothing();

  // Org membership
  await db.insert(orgMembers).values({
    id: "om_seed_001",
    orgId: ORG_ID,
    userId: USER_ID,
    role: "owner",
    joinedAt: new Date(),
  }).onConflictDoNothing();

  // Credit balance
  await db.insert(creditBalances).values({
    orgId: ORG_ID,
    balance: 2000,
    reserved: 0,
  }).onConflictDoNothing();

  // Projects
  const projectData = [
    {
      id: "proj_seed_001",
      orgId: ORG_ID,
      name: "E-commerce Platform",
      description: "Full-stack e-commerce with Next.js, tRPC, and Stripe",
      techStackPreset: "modern-saas",
      status: "active" as const,
    },
    {
      id: "proj_seed_002",
      orgId: ORG_ID,
      name: "Internal Dashboard",
      description: "Admin dashboard for managing customer data",
      techStackPreset: "fullstack-minimal",
      status: "setup" as const,
    },
  ];

  for (const proj of projectData) {
    await db.insert(projects).values(proj).onConflictDoNothing();
    await db.insert(projectSettings).values({
      projectId: proj.id,
    }).onConflictDoNothing();
    await db.insert(projectMembers).values({
      id: `pm_seed_${proj.id}`,
      projectId: proj.id,
      userId: USER_ID,
      role: "owner",
    }).onConflictDoNothing();
  }

  // Subscription plans
  const plans = [
    { id: "plan_hobby", name: "Hobby", creditsIncluded: 50, maxParallelAgents: 1, featuresJson: { maxTasksPerDay: 5 } },
    { id: "plan_starter", name: "Starter", stripePriceId: "price_starter", creditsIncluded: 500, maxParallelAgents: 2, featuresJson: { maxTasksPerDay: 50 } },
    { id: "plan_pro", name: "Pro", stripePriceId: "price_pro", creditsIncluded: 2000, maxParallelAgents: 5, featuresJson: { maxTasksPerDay: 200 } },
    { id: "plan_team", name: "Team", stripePriceId: "price_team", creditsIncluded: 8000, maxParallelAgents: 10, featuresJson: { maxTasksPerDay: 500 } },
    { id: "plan_studio", name: "Studio", stripePriceId: "price_studio", creditsIncluded: 25000, maxParallelAgents: 25, featuresJson: { maxTasksPerDay: 2000 } },
  ];

  for (const plan of plans) {
    await db.insert(subscriptionPlans).values(plan).onConflictDoNothing();
  }

  // Tech stack presets
  const presets = [
    { id: "preset_modern_saas", name: "Modern SaaS", slug: "modern-saas", description: "Next.js + tRPC + Drizzle + PostgreSQL", configJson: { framework: "nextjs" }, icon: "rocket" },
    { id: "preset_django_react", name: "Django + React", slug: "django-react", description: "Django REST + React SPA", configJson: { framework: "django" }, icon: "snake" },
    { id: "preset_rails", name: "Rails + Hotwire", slug: "rails", description: "Ruby on Rails full-stack", configJson: { framework: "rails" }, icon: "gem" },
    { id: "preset_go", name: "Go Microservices", slug: "go-microservices", description: "Go + gRPC + PostgreSQL", configJson: { framework: "go" }, icon: "server" },
  ];

  for (const preset of presets) {
    await db.insert(techStackPresets).values(preset).onConflictDoNothing();
  }

  console.log("Seed complete!");
  console.log("  - 1 organization (pro plan)");
  console.log("  - 1 user (dev@prometheus.local)");
  console.log("  - 2 projects");
  console.log("  - 2000 credits");
  console.log("  - 5 subscription plans");
  console.log("  - 4 tech stack presets");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
