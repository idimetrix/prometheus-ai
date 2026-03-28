/**
 * GAP-051: Skill Packs for Domains
 *
 * Defines skill packs for: ecommerce, mobile, data-pipeline, saas, devops, ml.
 * Each pack includes domain prompts, recommended tools, common patterns,
 * and example tasks. Selection is based on project type.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillPack {
  commonPatterns: string[];
  description: string;
  domainPrompts: string[];
  exampleTasks: string[];
  id: string;
  name: string;
  recommendedTools: string[];
}

// ---------------------------------------------------------------------------
// Skill Pack Definitions
// ---------------------------------------------------------------------------

export const ecommerceSkillPack: SkillPack = {
  id: "ecommerce",
  name: "E-Commerce",
  description:
    "Product catalogs, checkout flows, payment integration, inventory management",
  domainPrompts: [
    "Follow PCI DSS guidelines when handling payment data.",
    "Use optimistic UI for cart operations to improve perceived performance.",
    "Implement idempotency keys for all payment-related endpoints.",
    "Support multiple currencies and locale-aware price formatting.",
  ],
  recommendedTools: [
    "stripe-sdk",
    "algolia-search",
    "cloudinary-images",
    "redis-cart-cache",
    "analytics-tracker",
  ],
  commonPatterns: [
    "Repository pattern for product catalog access",
    "Event sourcing for order state transitions",
    "CQRS for product search vs product writes",
    "Saga pattern for multi-step checkout flow",
    "Circuit breaker for external payment providers",
  ],
  exampleTasks: [
    "Add a product variant selector with size/color options",
    "Implement cart abandonment email trigger",
    "Create a discount code validation endpoint",
    "Add inventory reservation on checkout start",
  ],
};

export const mobileSkillPack: SkillPack = {
  id: "mobile",
  name: "Mobile Development",
  description:
    "React Native, Flutter, native iOS/Android, offline-first, push notifications",
  domainPrompts: [
    "Design for offline-first: cache critical data locally using SQLite or AsyncStorage.",
    "Use optimistic updates for network operations to improve perceived responsiveness.",
    "Handle deep linking and universal links for seamless navigation.",
    "Implement proper app lifecycle handling (background, foreground, terminated).",
  ],
  recommendedTools: [
    "react-native-cli",
    "expo",
    "fastlane",
    "firebase-push",
    "detox-e2e",
  ],
  commonPatterns: [
    "Offline queue with retry and conflict resolution",
    "Pagination with infinite scroll and pull-to-refresh",
    "Secure token storage in platform keychain",
    "Adaptive layouts for tablets and foldables",
    "Background sync for pending mutations",
  ],
  exampleTasks: [
    "Add biometric authentication to the login screen",
    "Implement pull-to-refresh on the feed screen",
    "Create a push notification handler for order updates",
    "Add offline mode with queued mutations",
  ],
};

export const dataPipelineSkillPack: SkillPack = {
  id: "data-pipeline",
  name: "Data Pipeline",
  description:
    "ETL/ELT, stream processing, data warehousing, batch jobs, data quality",
  domainPrompts: [
    "Ensure all pipelines are idempotent and can safely be re-run.",
    "Implement data quality checks at every stage boundary.",
    "Use schema evolution strategies (e.g., Avro, Protobuf) for backward compatibility.",
    "Log lineage metadata for every transformation step.",
  ],
  recommendedTools: [
    "apache-kafka",
    "apache-spark",
    "dbt-transform",
    "airflow-scheduler",
    "great-expectations",
  ],
  commonPatterns: [
    "Dead letter queue for failed records",
    "Exactly-once semantics with transactional producers",
    "Slowly changing dimensions (SCD Type 2) for historical tracking",
    "Partitioned processing for parallel scalability",
    "Schema registry for contract enforcement",
  ],
  exampleTasks: [
    "Create a CDC pipeline from PostgreSQL to the data warehouse",
    "Add data quality validation for incoming CSV uploads",
    "Build a real-time aggregation pipeline for clickstream events",
    "Implement backfill logic for reprocessing historical data",
  ],
};

export const saasSkillPack: SkillPack = {
  id: "saas",
  name: "SaaS Platform",
  description:
    "Multi-tenancy, subscription billing, role-based access, onboarding flows",
  domainPrompts: [
    "Enforce tenant isolation at every data access layer using RLS or org_id filtering.",
    "Implement feature flags for progressive feature rollout per plan tier.",
    "Design webhook-first: emit events for all state changes for integrations.",
    "Support SSO (SAML/OIDC) for enterprise customers.",
  ],
  recommendedTools: [
    "stripe-billing",
    "clerk-auth",
    "launchdarkly-flags",
    "posthog-analytics",
    "intercom-support",
  ],
  commonPatterns: [
    "Row-level security for multi-tenant data isolation",
    "Plan-gated middleware for feature access control",
    "Webhook delivery with retry and dead letter queue",
    "Usage-based billing metering with periodic aggregation",
    "Invite flow with email verification and org assignment",
  ],
  exampleTasks: [
    "Add a team invitation flow with role selection",
    "Implement usage metering for API calls per plan",
    "Create an admin dashboard for tenant management",
    "Add SSO login with SAML provider configuration",
  ],
};

export const devopsSkillPackV2: SkillPack = {
  id: "devops",
  name: "DevOps & Infrastructure",
  description: "IaC, CI/CD pipelines, container orchestration, monitoring, SRE",
  domainPrompts: [
    "All infrastructure changes must go through code review (GitOps).",
    "Use multi-stage Docker builds to minimize image size and attack surface.",
    "Implement health checks (liveness + readiness) on all services.",
    "Alert on SLO violations using error budgets, not raw metrics.",
  ],
  recommendedTools: [
    "terraform",
    "helm-charts",
    "github-actions",
    "prometheus-monitoring",
    "grafana-dashboards",
  ],
  commonPatterns: [
    "Blue-green deployments for zero-downtime releases",
    "Canary analysis with automatic rollback",
    "Infrastructure as Code with drift detection",
    "Centralized structured logging with correlation IDs",
    "Distributed tracing with OpenTelemetry propagation",
  ],
  exampleTasks: [
    "Create a Terraform module for a new RDS instance",
    "Add a canary deployment stage to the CI/CD pipeline",
    "Set up Prometheus alerts for p95 latency SLO",
    "Create a Helm chart for the new microservice",
  ],
};

export const mlSkillPack: SkillPack = {
  id: "ml",
  name: "Machine Learning",
  description:
    "Model training, inference serving, feature stores, experiment tracking",
  domainPrompts: [
    "Track all experiment parameters, metrics, and artifacts for reproducibility.",
    "Version datasets alongside model versions for full lineage.",
    "Implement A/B testing infrastructure for model comparison in production.",
    "Monitor for data drift and model degradation continuously.",
  ],
  recommendedTools: [
    "mlflow-tracking",
    "wandb-experiments",
    "feast-feature-store",
    "ray-serve",
    "dvc-versioning",
  ],
  commonPatterns: [
    "Feature store for consistent feature computation (training + serving)",
    "Shadow deployment for new model validation",
    "Champion-challenger pattern for model promotion",
    "Batch prediction pipeline with result caching",
    "Online learning with periodic model refresh",
  ],
  exampleTasks: [
    "Set up an MLflow experiment for hyperparameter tuning",
    "Create a feature pipeline for user engagement signals",
    "Implement a model serving endpoint with A/B routing",
    "Add data drift detection using statistical tests",
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_SKILL_PACKS: Record<string, SkillPack> = {
  ecommerce: ecommerceSkillPack,
  mobile: mobileSkillPack,
  "data-pipeline": dataPipelineSkillPack,
  saas: saasSkillPack,
  devops: devopsSkillPackV2,
  ml: mlSkillPack,
};

/**
 * Select the best skill pack for a given project type.
 */
export function selectSkillPack(projectType: string): SkillPack | undefined {
  const normalized = projectType.toLowerCase().trim();

  // Direct match
  if (ALL_SKILL_PACKS[normalized]) {
    return ALL_SKILL_PACKS[normalized];
  }

  // Fuzzy match by keywords
  const keywordMap: Record<string, string> = {
    shop: "ecommerce",
    store: "ecommerce",
    cart: "ecommerce",
    payment: "ecommerce",
    ios: "mobile",
    android: "mobile",
    "react-native": "mobile",
    flutter: "mobile",
    etl: "data-pipeline",
    pipeline: "data-pipeline",
    warehouse: "data-pipeline",
    streaming: "data-pipeline",
    platform: "saas",
    "multi-tenant": "saas",
    billing: "saas",
    subscription: "saas",
    infrastructure: "devops",
    cicd: "devops",
    kubernetes: "devops",
    docker: "devops",
    training: "ml",
    model: "ml",
    inference: "ml",
    "machine-learning": "ml",
  };

  for (const [keyword, packId] of Object.entries(keywordMap)) {
    if (normalized.includes(keyword)) {
      return ALL_SKILL_PACKS[packId];
    }
  }

  return undefined;
}
