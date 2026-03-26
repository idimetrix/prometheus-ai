// MOON-007: Dependency Migration
export type {
  BreakingChange,
  DependencyMigrationOptions,
  DependencyMigrationResult,
} from "./dependency-migration";
export { DependencyMigrationPipeline } from "./dependency-migration";
// MOON-008: Framework Migration
export type {
  FrameworkMigrationAnalysis,
  FrameworkMigrationOptions,
  FrameworkMigrationResult,
} from "./framework-migration";
export { FrameworkMigrationPipeline } from "./framework-migration";
export type {
  FullStackConfig,
  GenerationResult,
} from "./full-stack-generator";
export { FullStackGenerator } from "./full-stack-generator";
// MOON-004: Incident Response
export type {
  AlertSeverity,
  AlertSource,
  IncidentAlert,
  IncidentResponseResult,
} from "./incident-response";
export { IncidentResponsePipeline } from "./incident-response";
export type { ResolveResult, SyncedIssueInput } from "./issue-resolver";
export { IssueResolver } from "./issue-resolver";
// MOON-009: Performance Optimization
export type {
  Optimization,
  OptimizationResult,
  OptimizationType,
  PerformanceMetrics,
} from "./performance-optimizer";
export { PerformanceOptimizationPipeline } from "./performance-optimizer";
export type {
  PRCommentWebhookPayload,
  PRReviewWebhookPayload,
} from "./pr-review-handler";
export { PRReviewHandler, prReviewHandler } from "./pr-review-handler";
export type { PRReview, PRReviewComment } from "./pr-review-responder";
export { PRReviewResponder } from "./pr-review-responder";
// MOON-001: Project Genesis
export type {
  ProjectGenesisOptions,
  ProjectGenesisResult,
} from "./project-genesis";
export { ProjectGenesisPipeline } from "./project-genesis";
// MOON-011: Security Patching
export type {
  RemainingVulnerability,
  SecurityPatchOptions,
  SecurityPatchResult,
} from "./security-patcher";
export { SecurityPatchingPipeline } from "./security-patcher";

// MOON-010: Self-Healing Deployment
export type {
  DeployOptions,
  DeployResult,
  MonitorResult,
} from "./self-healing-deploy";
export { SelfHealingDeployment } from "./self-healing-deploy";

// MOON-012: Smart Code Reviewer
export type {
  ReviewComment,
  ReviewCommentCategory,
  ReviewCommentSeverity,
  ReviewInput,
  ReviewResult,
  ReviewVerdict,
} from "./smart-reviewer";
export { SmartCodeReviewer } from "./smart-reviewer";
