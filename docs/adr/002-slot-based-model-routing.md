# ADR-002: Slot-Based Model Routing with Adaptive Fallback

## Status

Accepted

## Context

Prometheus uses multiple LLM providers (OpenAI, Anthropic, Google, and others) for different tasks within a single execution session. Different stages of task execution have fundamentally different requirements:

- **Planning** needs strong reasoning and broad context windows.
- **Code generation** needs high accuracy for syntax and semantics.
- **Code review** needs attention to detail and pattern recognition.
- **Quick classification** and routing tasks need low latency and low cost.

Naively routing all requests to a single "best" model wastes budget on trivial tasks and risks using underpowered models for critical ones. Additionally, provider outages, rate limits, and quota exhaustion are common -- the system must degrade gracefully rather than fail entirely.

Alternative approaches considered:

1. **Single-model configuration** -- simple but inflexible. No way to optimize cost or handle provider outages.
2. **User-specified model per request** -- shifts complexity to the user. Most users cannot make informed model selections for internal agent operations.
3. **Priority-list fallback** -- a static ordered list of models tried in sequence. Simple but does not account for task-specific requirements.
4. **Slot-based routing** -- define named "slots" (e.g., `planning`, `coding`, `review`, `fast`) that map to model preferences. Each slot has a primary model and ordered fallbacks. The router selects the appropriate model per-slot, falling back automatically on failure.

## Decision

Use slot-based model routing with adaptive fallback, implemented in the Model Router service (`apps/model-router`).

The design has three layers:

1. **Slots** -- named logical roles such as `planning`, `coding`, `review`, `fast`, and `embedding`. Each slot defines the kind of work the model will perform.

2. **Slot configuration** -- each organization can configure model preferences per slot. A slot configuration specifies a primary model key (e.g., `claude-sonnet-4-20250514`) and an ordered list of fallback models. Default configurations are provided for organizations that do not customize.

3. **Adaptive fallback** -- when a model request fails (rate limit, timeout, provider error), the router automatically tries the next model in the slot's fallback chain. Failure counts are tracked in Redis with sliding-window decay, and models that fail repeatedly are temporarily deprioritized. Recovery is automatic -- once the failure window expires, the model returns to its configured priority.

Cost tracking is integrated: every inference call logs token usage and estimated cost to the `model_usage_logs` table, attributed to the organization, session, and slot. This enables per-slot cost analytics and budget enforcement.

## Consequences

### Positive

- **Cost optimization** -- trivial tasks (classification, summarization) use cheap fast models; complex tasks (planning, coding) use capable ones. Organizations can tune the cost/quality tradeoff per slot.
- **Resilience** -- provider outages are handled transparently. If OpenAI is down, the coding slot falls back to Anthropic automatically. Users see degraded latency at worst, not failures.
- **Observability** -- per-slot usage tracking enables fine-grained analytics. Organizations can see exactly how much each type of work costs and which models are being used.
- **Flexibility** -- new models can be added to slot configurations without code changes. Organizations can A/B test models by adjusting slot priorities.
- **Separation of concerns** -- the orchestrator does not need to know about model selection. It requests inference for a named slot, and the Model Router handles the rest.

### Negative

- **Configuration complexity** -- slot definitions and fallback chains add configuration surface area. Defaults must be well-chosen so that most organizations never need to customize.
- **Latency on fallback** -- when a primary model fails, the fallback attempt adds latency. This is mitigated by aggressive timeouts and circuit-breaker patterns, but worst-case latency increases with each fallback step.
- **Model behavior differences** -- different models in the same slot may produce subtly different outputs. The orchestrator and agents must be robust to variations in formatting, tool-call conventions, and reasoning style across providers.
- **Redis dependency** -- failure tracking and slot state require Redis. If Redis is unavailable, the router falls back to the primary model without adaptive behavior.
