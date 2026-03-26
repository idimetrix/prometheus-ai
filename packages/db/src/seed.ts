/**
 * Database seed script for development.
 * Usage: pnpm db:seed (or tsx packages/db/src/seed.ts)
 *
 * Creates sample data for local development:
 * - 3 organizations (dev, staging, demo)
 * - Multiple users per org
 * - 5 projects with different tech stacks
 * - Sample sessions and tasks
 * - Credit balances
 * - Subscription plan definitions
 * - Tech stack presets
 */

import { db } from "./client";
import {
  creditBalances,
  organizations,
  orgMembers,
  projectMembers,
  projectSettings,
  projects,
  sessionEvents,
  sessions,
  subscriptionPlans,
  tasks,
  techStackPresets,
  users,
} from "./schema";

// Organization IDs
const ORG_DEV_ID = "org_seed_dev001";
const ORG_STAGING_ID = "org_seed_staging001";
const ORG_DEMO_ID = "org_seed_demo001";

// User IDs
const USER_DEV_ADMIN = "usr_seed_dev001";
const USER_DEV_ENG = "usr_seed_dev002";
const USER_DEV_DESIGNER = "usr_seed_dev003";
const USER_STAGING_LEAD = "usr_seed_staging001";
const USER_STAGING_QA = "usr_seed_staging002";
const USER_DEMO_PM = "usr_seed_demo001";
const USER_DEMO_ENG = "usr_seed_demo002";

async function seed() {
  console.log("Seeding database...");

  // ── Organizations ──────────────────────────────────────────────

  const orgs = [
    {
      id: ORG_DEV_ID,
      name: "Dev Organization",
      slug: "dev-org",
      planTier: "pro" as const,
    },
    {
      id: ORG_STAGING_ID,
      name: "Staging Corp",
      slug: "staging-corp",
      planTier: "team" as const,
    },
    {
      id: ORG_DEMO_ID,
      name: "Demo Labs",
      slug: "demo-labs",
      planTier: "starter" as const,
    },
  ];

  for (const org of orgs) {
    await db.insert(organizations).values(org).onConflictDoNothing();
  }

  // ── Users ──────────────────────────────────────────────────────

  const allUsers = [
    {
      id: USER_DEV_ADMIN,
      clerkId: USER_DEV_ADMIN,
      email: "dev@prometheus.local",
      name: "Dev User",
    },
    {
      id: USER_DEV_ENG,
      clerkId: "user_dev_eng_clerk",
      email: "engineer@prometheus.local",
      name: "Alice Engineer",
    },
    {
      id: USER_DEV_DESIGNER,
      clerkId: "user_dev_designer_clerk",
      email: "designer@prometheus.local",
      name: "Bob Designer",
    },
    {
      id: USER_STAGING_LEAD,
      clerkId: "user_staging_lead_clerk",
      email: "lead@staging-corp.local",
      name: "Carol Lead",
    },
    {
      id: USER_STAGING_QA,
      clerkId: "user_staging_qa_clerk",
      email: "qa@staging-corp.local",
      name: "Dave QA",
    },
    {
      id: USER_DEMO_PM,
      clerkId: "user_demo_pm_clerk",
      email: "pm@demo-labs.local",
      name: "Eve Product",
    },
    {
      id: USER_DEMO_ENG,
      clerkId: "user_demo_eng_clerk",
      email: "frank@demo-labs.local",
      name: "Frank Developer",
    },
  ];

  for (const user of allUsers) {
    await db.insert(users).values(user).onConflictDoNothing();
  }

  // ── Org memberships ────────────────────────────────────────────

  const memberships = [
    // Dev org
    {
      id: "om_seed_001",
      orgId: ORG_DEV_ID,
      userId: USER_DEV_ADMIN,
      role: "owner" as const,
      joinedAt: new Date(),
    },
    {
      id: "om_seed_002",
      orgId: ORG_DEV_ID,
      userId: USER_DEV_ENG,
      role: "member" as const,
      joinedAt: new Date(),
    },
    {
      id: "om_seed_003",
      orgId: ORG_DEV_ID,
      userId: USER_DEV_DESIGNER,
      role: "member" as const,
      joinedAt: new Date(),
    },
    // Staging org
    {
      id: "om_seed_004",
      orgId: ORG_STAGING_ID,
      userId: USER_STAGING_LEAD,
      role: "owner" as const,
      joinedAt: new Date(),
    },
    {
      id: "om_seed_005",
      orgId: ORG_STAGING_ID,
      userId: USER_STAGING_QA,
      role: "member" as const,
      joinedAt: new Date(),
    },
    // Demo org
    {
      id: "om_seed_006",
      orgId: ORG_DEMO_ID,
      userId: USER_DEMO_PM,
      role: "owner" as const,
      joinedAt: new Date(),
    },
    {
      id: "om_seed_007",
      orgId: ORG_DEMO_ID,
      userId: USER_DEMO_ENG,
      role: "member" as const,
      joinedAt: new Date(),
    },
  ];

  for (const membership of memberships) {
    await db.insert(orgMembers).values(membership).onConflictDoNothing();
  }

  // ── Credit balances ────────────────────────────────────────────

  const credits = [
    { orgId: ORG_DEV_ID, balance: 2000, reserved: 0 },
    { orgId: ORG_STAGING_ID, balance: 8000, reserved: 150 },
    { orgId: ORG_DEMO_ID, balance: 500, reserved: 0 },
  ];

  for (const credit of credits) {
    await db.insert(creditBalances).values(credit).onConflictDoNothing();
  }

  // ── Projects (5 with different tech stacks) ────────────────────

  const projectData = [
    {
      id: "proj_seed_001",
      orgId: ORG_DEV_ID,
      name: "E-commerce Platform",
      description: "Full-stack e-commerce with Next.js, tRPC, and Stripe",
      techStackPreset: "modern-saas",
      status: "active" as const,
    },
    {
      id: "proj_seed_002",
      orgId: ORG_DEV_ID,
      name: "Internal Dashboard",
      description: "Admin dashboard for managing customer data",
      techStackPreset: "fullstack-minimal",
      status: "setup" as const,
    },
    {
      id: "proj_seed_003",
      orgId: ORG_DEV_ID,
      name: "Mobile API Backend",
      description: "Go-based REST API powering iOS and Android apps",
      techStackPreset: "go-microservices",
      status: "active" as const,
    },
    {
      id: "proj_seed_004",
      orgId: ORG_STAGING_ID,
      name: "Analytics Pipeline",
      description: "Data ingestion and reporting with Django and React",
      techStackPreset: "django-react",
      status: "active" as const,
    },
    {
      id: "proj_seed_005",
      orgId: ORG_DEMO_ID,
      name: "Landing Page Builder",
      description: "Rails-based CMS for marketing landing pages",
      techStackPreset: "rails",
      status: "active" as const,
    },
  ];

  const projectMemberMapping: Record<
    string,
    Array<{ userId: string; role: "owner" | "contributor" | "viewer" }>
  > = {
    proj_seed_001: [
      { userId: USER_DEV_ADMIN, role: "owner" },
      { userId: USER_DEV_ENG, role: "contributor" },
      { userId: USER_DEV_DESIGNER, role: "viewer" },
    ],
    proj_seed_002: [
      { userId: USER_DEV_ENG, role: "owner" },
      { userId: USER_DEV_ADMIN, role: "contributor" },
    ],
    proj_seed_003: [{ userId: USER_DEV_ENG, role: "owner" }],
    proj_seed_004: [
      { userId: USER_STAGING_LEAD, role: "owner" },
      { userId: USER_STAGING_QA, role: "contributor" },
    ],
    proj_seed_005: [
      { userId: USER_DEMO_PM, role: "owner" },
      { userId: USER_DEMO_ENG, role: "contributor" },
    ],
  };

  for (const proj of projectData) {
    await db.insert(projects).values(proj).onConflictDoNothing();
    await db
      .insert(projectSettings)
      .values({ projectId: proj.id })
      .onConflictDoNothing();

    const members = projectMemberMapping[proj.id] ?? [];
    for (const member of members) {
      await db
        .insert(projectMembers)
        .values({
          id: `pm_seed_${proj.id}_${member.userId}`,
          projectId: proj.id,
          userId: member.userId,
          role: member.role,
        })
        .onConflictDoNothing();
    }
  }

  // ── Sessions ───────────────────────────────────────────────────

  const sessionData = [
    {
      id: "sess_seed_001",
      projectId: "proj_seed_001",
      userId: USER_DEV_ADMIN,
      status: "completed" as const,
      mode: "task" as const,
      startedAt: new Date("2026-03-10T10:00:00Z"),
      endedAt: new Date("2026-03-10T10:45:00Z"),
    },
    {
      id: "sess_seed_002",
      projectId: "proj_seed_001",
      userId: USER_DEV_ENG,
      status: "active" as const,
      mode: "ask" as const,
      startedAt: new Date("2026-03-18T14:00:00Z"),
    },
    {
      id: "sess_seed_003",
      projectId: "proj_seed_003",
      userId: USER_DEV_ENG,
      status: "completed" as const,
      mode: "task" as const,
      startedAt: new Date("2026-03-15T09:00:00Z"),
      endedAt: new Date("2026-03-15T11:30:00Z"),
    },
    {
      id: "sess_seed_004",
      projectId: "proj_seed_004",
      userId: USER_STAGING_LEAD,
      status: "active" as const,
      mode: "task" as const,
      startedAt: new Date("2026-03-19T08:00:00Z"),
    },
    {
      id: "sess_seed_005",
      projectId: "proj_seed_005",
      userId: USER_DEMO_PM,
      status: "completed" as const,
      mode: "ask" as const,
      startedAt: new Date("2026-03-12T16:00:00Z"),
      endedAt: new Date("2026-03-12T16:20:00Z"),
    },
  ];

  for (const session of sessionData) {
    await db.insert(sessions).values(session).onConflictDoNothing();
  }

  // ── Session events ─────────────────────────────────────────────

  const eventData = [
    {
      id: "sevt_seed_001",
      sessionId: "sess_seed_001",
      type: "task_status" as const,
      data: { taskTitle: "Implement checkout flow" },
    },
    {
      id: "sevt_seed_002",
      sessionId: "sess_seed_001",
      type: "agent_output" as const,
      data: { agentRole: "coder", model: "claude-3-opus" },
    },
    {
      id: "sevt_seed_003",
      sessionId: "sess_seed_002",
      type: "agent_output" as const,
      data: { content: "Help me debug the cart component" },
    },
    {
      id: "sevt_seed_004",
      sessionId: "sess_seed_004",
      type: "task_status" as const,
      data: { taskTitle: "Set up data pipeline" },
    },
  ];

  for (const event of eventData) {
    await db.insert(sessionEvents).values(event).onConflictDoNothing();
  }

  // ── Tasks ──────────────────────────────────────────────────────

  const taskData = [
    {
      id: "task_seed_001",
      sessionId: "sess_seed_001",
      projectId: "proj_seed_001",
      orgId: ORG_DEV_ID,
      title: "Implement checkout flow",
      description:
        "Build the complete checkout experience including cart summary, payment form, and order confirmation",
      status: "completed" as const,
      priority: 80,
      agentRole: "coder",
      creditsReserved: 50,
      creditsConsumed: 42,
      startedAt: new Date("2026-03-10T10:05:00Z"),
      completedAt: new Date("2026-03-10T10:40:00Z"),
    },
    {
      id: "task_seed_002",
      sessionId: "sess_seed_002",
      projectId: "proj_seed_001",
      orgId: ORG_DEV_ID,
      title: "Debug cart state management",
      description: "Fix race condition in cart quantity updates",
      status: "running" as const,
      priority: 90,
      agentRole: "debugger",
      creditsReserved: 30,
      creditsConsumed: 12,
      startedAt: new Date("2026-03-18T14:05:00Z"),
    },
    {
      id: "task_seed_003",
      sessionId: "sess_seed_003",
      projectId: "proj_seed_003",
      orgId: ORG_DEV_ID,
      title: "Add rate limiting middleware",
      description: "Implement token bucket rate limiter for all API endpoints",
      status: "completed" as const,
      priority: 70,
      agentRole: "coder",
      creditsReserved: 40,
      creditsConsumed: 35,
      startedAt: new Date("2026-03-15T09:10:00Z"),
      completedAt: new Date("2026-03-15T11:00:00Z"),
    },
    {
      id: "task_seed_004",
      sessionId: "sess_seed_004",
      projectId: "proj_seed_004",
      orgId: ORG_STAGING_ID,
      title: "Set up data ingestion pipeline",
      description:
        "Create Django management command to ingest CSV data from S3",
      status: "running" as const,
      priority: 60,
      agentRole: "coder",
      creditsReserved: 80,
      creditsConsumed: 20,
      startedAt: new Date("2026-03-19T08:10:00Z"),
    },
    {
      id: "task_seed_005",
      sessionId: "sess_seed_005",
      projectId: "proj_seed_005",
      orgId: ORG_DEMO_ID,
      title: "Create landing page template",
      description:
        "Build a reusable hero + features + CTA landing page template",
      status: "completed" as const,
      priority: 50,
      agentRole: "coder",
      creditsReserved: 20,
      creditsConsumed: 18,
      startedAt: new Date("2026-03-12T16:02:00Z"),
      completedAt: new Date("2026-03-12T16:18:00Z"),
    },
    {
      id: "task_seed_006",
      sessionId: "sess_seed_003",
      projectId: "proj_seed_003",
      orgId: ORG_DEV_ID,
      title: "Write API integration tests",
      description: "Add comprehensive integration tests for all REST endpoints",
      status: "completed" as const,
      priority: 60,
      agentRole: "tester",
      creditsReserved: 25,
      creditsConsumed: 22,
      startedAt: new Date("2026-03-15T10:00:00Z"),
      completedAt: new Date("2026-03-15T11:20:00Z"),
    },
    {
      id: "task_seed_007",
      sessionId: "sess_seed_004",
      projectId: "proj_seed_004",
      orgId: ORG_STAGING_ID,
      title: "Build reporting dashboard",
      description: "Create React dashboard with charts for pipeline metrics",
      status: "pending" as const,
      priority: 40,
      agentRole: "coder",
      creditsReserved: 60,
      creditsConsumed: 0,
    },
  ];

  for (const task of taskData) {
    await db.insert(tasks).values(task).onConflictDoNothing();
  }

  // ── Subscription plans ─────────────────────────────────────────

  const plans = [
    {
      id: "plan_hobby",
      name: "Hobby",
      creditsIncluded: 50,
      maxParallelAgents: 1,
      featuresJson: { maxTasksPerDay: 5 },
    },
    {
      id: "plan_starter",
      name: "Starter",
      stripePriceId: "price_starter",
      creditsIncluded: 500,
      maxParallelAgents: 2,
      featuresJson: { maxTasksPerDay: 50 },
    },
    {
      id: "plan_pro",
      name: "Pro",
      stripePriceId: "price_pro",
      creditsIncluded: 2000,
      maxParallelAgents: 5,
      featuresJson: { maxTasksPerDay: 200 },
    },
    {
      id: "plan_team",
      name: "Team",
      stripePriceId: "price_team",
      creditsIncluded: 8000,
      maxParallelAgents: 10,
      featuresJson: { maxTasksPerDay: 500 },
    },
    {
      id: "plan_studio",
      name: "Studio",
      stripePriceId: "price_studio",
      creditsIncluded: 25_000,
      maxParallelAgents: 25,
      featuresJson: { maxTasksPerDay: 2000 },
    },
  ];

  for (const plan of plans) {
    await db.insert(subscriptionPlans).values(plan).onConflictDoNothing();
  }

  // ── Tech stack presets ─────────────────────────────────────────

  const presets = [
    {
      id: "preset_modern_saas",
      name: "Modern SaaS",
      slug: "modern-saas",
      description: "Next.js + tRPC + Drizzle + PostgreSQL",
      configJson: { framework: "nextjs" },
      icon: "rocket",
    },
    {
      id: "preset_django_react",
      name: "Django + React",
      slug: "django-react",
      description: "Django REST + React SPA",
      configJson: { framework: "django" },
      icon: "snake",
    },
    {
      id: "preset_rails",
      name: "Rails + Hotwire",
      slug: "rails",
      description: "Ruby on Rails full-stack",
      configJson: { framework: "rails" },
      icon: "gem",
    },
    {
      id: "preset_go",
      name: "Go Microservices",
      slug: "go-microservices",
      description: "Go + gRPC + PostgreSQL",
      configJson: { framework: "go" },
      icon: "server",
    },
  ];

  for (const preset of presets) {
    await db.insert(techStackPresets).values(preset).onConflictDoNothing();
  }

  console.log("Seed complete!");
  console.log("  - 3 organizations (dev/pro, staging/team, demo/starter)");
  console.log("  - 7 users across organizations");
  console.log("  - 5 projects with different tech stacks");
  console.log("  - 5 sessions (3 completed, 2 active)");
  console.log("  - 7 tasks (4 completed, 2 in-progress, 1 pending)");
  console.log("  - 4 session events");
  console.log("  - Credit balances per org");
  console.log("  - 5 subscription plans");
  console.log("  - 4 tech stack presets");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
