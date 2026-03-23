export {
  TrainingDataCollector,
  type TrainingExample,
  type TrainingMessage,
  type TrainingStats,
} from "./training-data-collector";

/** Configuration for a fine-tuning job. */
export interface FineTuningConfig {
  /** Base model to fine-tune (e.g. "gpt-4o-mini", "llama-3.1-8b") */
  baseModel: string;
  /** Batch size per training step */
  batchSize: number;
  /** Number of training epochs */
  epochs: number;
  /** Learning rate for the training run */
  learningRate: number;
}
