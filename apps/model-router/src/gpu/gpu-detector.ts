/**
 * GPU detection and configuration for local model inference.
 *
 * Detects available GPUs (NVIDIA, AMD, Apple Silicon), recommends
 * models that fit in available VRAM, and suggests appropriate
 * quantization levels.
 */
import { execFileSync } from "node:child_process";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:gpu-detector");

const CUDA_RELEASE_RE = /release (\d+\.\d+)/;
const LEADING_DIGITS_RE = /(\d+)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GPUInfo {
  /** Whether a usable GPU was detected */
  available: boolean;
  /** CUDA version if NVIDIA */
  cudaVersion?: string;
  /** Driver version string */
  driver: string;
  /** GPU model name */
  model: string;
  /** GPU vendor (nvidia, amd, apple, unknown) */
  vendor: string;
  /** Available VRAM in megabytes */
  vramMb: number;
}

export interface RecommendedModel {
  /** Whether it fits in available VRAM */
  fits: boolean;
  /** Model identifier */
  name: string;
  /** Suggested quantization level */
  quantization: string;
  /** Approximate size in GB at the suggested quantization */
  sizeGb: number;
}

// ---------------------------------------------------------------------------
// Known model sizes (approximate, in GB at FP16)
// ---------------------------------------------------------------------------

const MODEL_SIZES: Array<{ name: string; fp16Gb: number }> = [
  { name: "phi-3-mini-4k", fp16Gb: 7.6 },
  { name: "llama-3.1-8b", fp16Gb: 16 },
  { name: "mistral-7b", fp16Gb: 14.5 },
  { name: "codellama-7b", fp16Gb: 13 },
  { name: "llama-3.1-70b", fp16Gb: 140 },
  { name: "deepseek-coder-6.7b", fp16Gb: 13 },
  { name: "qwen2.5-coder-7b", fp16Gb: 14 },
  { name: "gemma-2-9b", fp16Gb: 18 },
];

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function execSafe(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function detectNvidia(): GPUInfo | null {
  const smiOutput = execSafe("nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
  ]);
  if (!smiOutput) {
    return null;
  }

  const parts = smiOutput.split(",").map((s) => s.trim());
  const model = parts[0] ?? "Unknown NVIDIA GPU";
  const vramMb = Number.parseInt(parts[1] ?? "0", 10);
  const driver = parts[2] ?? "unknown";

  // Try to get CUDA version
  const cudaOutput = execSafe("nvcc", ["--version"]);
  let cudaVersion: string | undefined;
  if (cudaOutput) {
    const match = cudaOutput.match(CUDA_RELEASE_RE);
    if (match) {
      cudaVersion = match[1];
    }
  }

  return {
    available: true,
    vendor: "nvidia",
    model,
    vramMb,
    driver,
    cudaVersion,
  };
}

function detectAmd(): GPUInfo | null {
  const rocmOutput = execSafe("rocm-smi", ["--showmeminfo", "vram", "--csv"]);
  if (!rocmOutput) {
    return null;
  }

  // Parse rocm-smi CSV output
  const lines = rocmOutput.split("\n").filter((l) => l.trim().length > 0);
  let vramMb = 0;
  for (const line of lines) {
    const match = line.match(LEADING_DIGITS_RE);
    if (match) {
      const value = Number.parseInt(match[1] ?? "0", 10);
      if (value > 1_000_000) {
        vramMb = Math.round(value / (1024 * 1024));
      } else {
        vramMb = value;
      }
      break;
    }
  }

  const idOutput = execSafe("rocm-smi", ["--showproductname"]);
  const model = idOutput?.split("\n").pop()?.trim() ?? "Unknown AMD GPU";

  const driverOutput = execSafe("rocm-smi", ["--showdriverversion"]);
  const driver = driverOutput?.split("\n").pop()?.trim() ?? "unknown";

  return {
    available: true,
    vendor: "amd",
    model,
    vramMb,
    driver,
  };
}

function detectApple(): GPUInfo | null {
  const spOutput = execSafe("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!spOutput) {
    return null;
  }

  try {
    const data = JSON.parse(spOutput);
    const displays = data.SPDisplaysDataType;
    if (!Array.isArray(displays) || displays.length === 0) {
      return null;
    }

    const gpu = displays[0];
    const model = gpu.sppci_model ?? "Apple GPU";

    // Apple Silicon shares unified memory; try to get total memory
    const memOutput = execSafe("sysctl", ["-n", "hw.memsize"]);
    const totalMem = memOutput ? Number.parseInt(memOutput, 10) : 0;
    // Assume ~75% of unified memory is usable for GPU tasks
    const vramMb =
      totalMem > 0 ? Math.round((totalMem * 0.75) / (1024 * 1024)) : 0;

    return {
      available: true,
      vendor: "apple",
      model,
      vramMb,
      driver: "Metal",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect available GPU hardware. Checks NVIDIA, AMD, and Apple GPUs
 * in order of preference. Returns sensible defaults if no GPU is found.
 */
export function detectGPU(): GPUInfo {
  logger.debug("Detecting GPU hardware...");

  // Try NVIDIA first (most common for inference)
  const nvidia = detectNvidia();
  if (nvidia) {
    logger.info(
      { vendor: "nvidia", model: nvidia.model, vramMb: nvidia.vramMb },
      "Detected NVIDIA GPU"
    );
    return nvidia;
  }

  // Try AMD
  const amd = detectAmd();
  if (amd) {
    logger.info(
      { vendor: "amd", model: amd.model, vramMb: amd.vramMb },
      "Detected AMD GPU"
    );
    return amd;
  }

  // Try Apple Silicon
  const apple = detectApple();
  if (apple) {
    logger.info(
      { vendor: "apple", model: apple.model, vramMb: apple.vramMb },
      "Detected Apple GPU"
    );
    return apple;
  }

  logger.info("No GPU detected; using CPU-only defaults");
  return {
    available: false,
    vendor: "unknown",
    model: "none",
    vramMb: 0,
    driver: "none",
  };
}

/**
 * Recommend models that fit in the given VRAM budget.
 * Models are returned with appropriate quantization levels.
 */
export function getRecommendedModels(vramMb: number): RecommendedModel[] {
  const vramGb = vramMb / 1024;
  const results: RecommendedModel[] = [];

  for (const model of MODEL_SIZES) {
    const quantization = getQuantizationLevel(vramMb, model.fp16Gb);
    const quantizedSize = applyQuantization(model.fp16Gb, quantization);
    const fits = quantizedSize <= vramGb * 0.9; // Leave 10% headroom

    results.push({
      name: model.name,
      sizeGb: Math.round(quantizedSize * 10) / 10,
      quantization,
      fits,
    });
  }

  // Sort: fitting models first, then by size descending (prefer larger models)
  results.sort((a, b) => {
    if (a.fits !== b.fits) {
      return a.fits ? -1 : 1;
    }
    return b.sizeGb - a.sizeGb;
  });

  return results;
}

/**
 * Recommend a quantization level based on available VRAM and model size.
 *
 * - Q4: ~25% of FP16 size (aggressive, some quality loss)
 * - Q5: ~31% of FP16 size (balanced)
 * - Q8: ~50% of FP16 size (high quality)
 * - FP16: full precision
 */
export function getQuantizationLevel(
  vramMb: number,
  modelSizeGb: number
): string {
  const vramGb = vramMb / 1024;
  const headroom = vramGb * 0.9; // Leave 10% for runtime overhead

  if (modelSizeGb * 0.5 <= headroom) {
    return "Q8";
  }
  if (modelSizeGb * 0.31 <= headroom) {
    return "Q5";
  }
  if (modelSizeGb * 0.25 <= headroom) {
    return "Q4";
  }
  return "Q4"; // Default to most aggressive quantization
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyQuantization(fp16Gb: number, level: string): number {
  switch (level) {
    case "Q4":
      return fp16Gb * 0.25;
    case "Q5":
      return fp16Gb * 0.31;
    case "Q8":
      return fp16Gb * 0.5;
    case "FP16":
      return fp16Gb;
    default:
      return fp16Gb * 0.25;
  }
}
