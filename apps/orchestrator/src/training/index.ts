// MOON-002: Self-improving agents
export {
  type ApplyResult,
  type ExecutionAnalysis,
  type ImprovementSet,
  SelfImprovingAgent,
} from "./self-improvement";
export {
  type DecisionNode,
  type PatternDecisionTree,
  SelfPlayTrainer,
  type TrainingExample,
  type TrainingMetrics,
} from "./self-play-trainer";
// MOON-048: Self-play training loop
export {
  type EpochResult,
  SelfPlayTrainingLoop,
  type TrainingEpochOptions,
  type TrainingLoopResult,
  type TrainingPairOptions,
  type TrainingPairResult,
} from "./self-play-training-loop";
export {
  type TrainingRunConfig,
  TrainingRunner,
  type TrainingRunResult,
} from "./training-runner";
export {
  type InsightCategory,
  type LearningInsight,
  SharedLearningStore,
  type TransferResult,
} from "./transfer-learning";
