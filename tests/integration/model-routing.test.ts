/**
 * Integration tests: Model routing slot resolution and fallback chain.
 *
 * Verifies slot-to-model resolution, provider fallback chains,
 * and routing slot selection logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { mockLogger: logger };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => mockLogger,
}));

// ---------------------------------------------------------------------------
// Slot resolution simulation (mirrors @prometheus/ai slot logic)
// ---------------------------------------------------------------------------

type RoutingSlot =
  | "default"
  | "think"
  | "longContext"
  | "background"
  | "vision"
  | "review"
  | "fastLoop"
  | "premium";

interface SlotConfig {
  chain: string[];
  defaultTemperature: number;
  preferStreaming: boolean;
  slot: RoutingSlot;
}

const SLOT_CONFIGS: Record<RoutingSlot, SlotConfig> = {
  default: {
    slot: "default",
    chain: [
      "ollama/qwen2.5-coder:32b",
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
    ],
    defaultTemperature: 0.7,
    preferStreaming: true,
  },
  think: {
    slot: "think",
    chain: [
      "ollama/qwq:32b",
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
    ],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },
  longContext: {
    slot: "longContext",
    chain: [
      "gemini/gemini-2.5-flash",
      "ollama/qwen2.5-coder:32b",
      "groq/llama-3.3-70b-versatile",
    ],
    defaultTemperature: 0.3,
    preferStreaming: true,
  },
  fastLoop: {
    slot: "fastLoop",
    chain: [
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
      "ollama/qwen2.5-coder:14b",
    ],
    defaultTemperature: 0.7,
    preferStreaming: true,
  },
  background: {
    slot: "background",
    chain: ["ollama/qwen2.5-coder:14b", "ollama/qwen2.5-coder:7b"],
    defaultTemperature: 0.3,
    preferStreaming: false,
  },
  vision: {
    slot: "vision",
    chain: ["anthropic/claude-sonnet-4-20250514", "gemini/gemini-2.5-flash"],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },
  review: {
    slot: "review",
    chain: [
      "anthropic/claude-sonnet-4-20250514",
      "gemini/gemini-2.5-flash",
      "ollama/qwq:32b",
    ],
    defaultTemperature: 0.3,
    preferStreaming: true,
  },
  premium: {
    slot: "premium",
    chain: [
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4.1",
      "gemini/gemini-2.5-pro",
    ],
    defaultTemperature: 0.5,
    preferStreaming: true,
  },
};

const ROLE_SLOT_MAP: Record<string, RoutingSlot> = {
  orchestrator: "think",
  discovery: "longContext",
  architect: "think",
  planner: "think",
  frontend_coder: "default",
  backend_coder: "default",
  integration_coder: "fastLoop",
  test_engineer: "fastLoop",
  ci_loop: "fastLoop",
  security_auditor: "think",
  deploy_engineer: "default",
  documentation_specialist: "longContext",
};

interface ProviderHealth {
  errorRate: number;
  healthy: boolean;
  latencyMs: number;
}

function resolveSlot(slotName: string): SlotConfig | null {
  return SLOT_CONFIGS[slotName as RoutingSlot] ?? null;
}

function resolveSlotForRole(agentRole: string): SlotConfig {
  const slotName = ROLE_SLOT_MAP[agentRole] ?? "default";
  return SLOT_CONFIGS[slotName];
}

function resolveWithFallback(
  slotName: string,
  providerHealth: Map<string, ProviderHealth>
): string | null {
  const config = resolveSlot(slotName);
  if (!config) {
    return null;
  }

  for (const modelKey of config.chain) {
    const provider = modelKey.split("/")[0];
    const health = providerHealth.get(provider);
    if (!health || health.healthy) {
      return modelKey;
    }
  }
  return null; // all providers down
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Model routing integration", () => {
  let providerHealth: Map<string, ProviderHealth>;

  beforeEach(() => {
    providerHealth = new Map();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("slot resolution", () => {
    it("resolves known slot names to configurations", () => {
      const slots: RoutingSlot[] = [
        "default",
        "think",
        "longContext",
        "fastLoop",
        "premium",
      ];

      for (const slotName of slots) {
        const config = resolveSlot(slotName);
        expect(config).not.toBeNull();
        expect(config?.slot).toBe(slotName);
        expect(config?.chain.length).toBeGreaterThan(0);
      }
    });

    it("returns null for unknown slot names", () => {
      expect(resolveSlot("nonexistent")).toBeNull();
      expect(resolveSlot("")).toBeNull();
    });

    it("each slot has a valid primary model", () => {
      for (const [name, config] of Object.entries(SLOT_CONFIGS)) {
        expect(config.chain.length).toBeGreaterThan(0);
        const primary = config.chain[0];
        expect(primary).toContain("/"); // format: provider/model
        expect(config.slot).toBe(name);
      }
    });

    it("slots have appropriate temperature defaults", () => {
      // Thinking and review should have lower temperatures for precision
      expect(SLOT_CONFIGS.think.defaultTemperature).toBeLessThanOrEqual(0.5);
      expect(SLOT_CONFIGS.review.defaultTemperature).toBeLessThanOrEqual(0.5);
      // Background should be low temperature for deterministic tasks
      expect(SLOT_CONFIGS.background.defaultTemperature).toBeLessThanOrEqual(
        0.5
      );
    });
  });

  describe("role-to-slot mapping", () => {
    it("maps each agent role to an appropriate slot", () => {
      expect(resolveSlotForRole("orchestrator").slot).toBe("think");
      expect(resolveSlotForRole("architect").slot).toBe("think");
      expect(resolveSlotForRole("frontend_coder").slot).toBe("default");
      expect(resolveSlotForRole("backend_coder").slot).toBe("default");
      expect(resolveSlotForRole("test_engineer").slot).toBe("fastLoop");
      expect(resolveSlotForRole("ci_loop").slot).toBe("fastLoop");
      expect(resolveSlotForRole("discovery").slot).toBe("longContext");
    });

    it("falls back to default slot for unknown roles", () => {
      const config = resolveSlotForRole("unknown_role");
      expect(config.slot).toBe("default");
    });
  });

  describe("fallback chain logic", () => {
    it("returns primary model when all providers are healthy", () => {
      const model = resolveWithFallback("default", providerHealth);
      expect(model).toBe(SLOT_CONFIGS.default.chain[0]);
    });

    it("falls back to next model when primary provider is down", () => {
      providerHealth.set("ollama", {
        healthy: false,
        latencyMs: 0,
        errorRate: 1.0,
      });

      const model = resolveWithFallback("default", providerHealth);
      expect(model).not.toBe(SLOT_CONFIGS.default.chain[0]);
      expect(model).toBe(SLOT_CONFIGS.default.chain[1]);
    });

    it("returns null when all providers in the chain are down", () => {
      // Mark all providers in the default chain as unhealthy
      for (const modelKey of SLOT_CONFIGS.default.chain) {
        const provider = modelKey.split("/")[0];
        providerHealth.set(provider, {
          healthy: false,
          latencyMs: 0,
          errorRate: 1.0,
        });
      }

      const model = resolveWithFallback("default", providerHealth);
      expect(model).toBeNull();
    });

    it("skips unhealthy providers and finds the first healthy one", () => {
      // Mark first two providers as unhealthy
      const chain = SLOT_CONFIGS.default.chain;
      for (let i = 0; i < Math.min(2, chain.length); i++) {
        const provider = chain[i].split("/")[0];
        providerHealth.set(provider, {
          healthy: false,
          latencyMs: 0,
          errorRate: 1.0,
        });
      }

      const model = resolveWithFallback("default", providerHealth);
      if (chain.length > 2) {
        expect(model).toBe(chain[2]);
      } else {
        expect(model).toBeNull();
      }
    });

    it("premium slot falls through paid providers correctly", () => {
      const premiumChain = SLOT_CONFIGS.premium.chain;
      expect(premiumChain.length).toBeGreaterThanOrEqual(2);

      // Mark first provider down
      const firstProvider = premiumChain[0].split("/")[0];
      providerHealth.set(firstProvider, {
        healthy: false,
        latencyMs: 0,
        errorRate: 1.0,
      });

      const model = resolveWithFallback("premium", providerHealth);
      expect(model).toBe(premiumChain[1]);
    });
  });

  describe("streaming preference", () => {
    it("background slot does not prefer streaming", () => {
      expect(SLOT_CONFIGS.background.preferStreaming).toBe(false);
    });

    it("all other slots prefer streaming", () => {
      const nonStreamingSlots = new Set(["background"]);
      for (const [name, config] of Object.entries(SLOT_CONFIGS)) {
        if (!nonStreamingSlots.has(name)) {
          expect(config.preferStreaming).toBe(true);
        }
      }
    });
  });
});
