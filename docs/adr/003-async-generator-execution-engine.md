# ADR-003: Async Generator Pattern for Execution Engine

## Status

Accepted

## Context

The Prometheus orchestrator executes multi-step agent tasks that involve planning, code generation, sandbox execution, tool calls, and human-in-the-loop checkpoints. Each step can take seconds to minutes, and users expect real-time streaming of progress and intermediate results.

Several execution patterns were evaluated:

1. **Sequential async/await** -- each step runs to completion before the next starts. Simple but provides no streaming, no pause/resume, and no ability to inject human decisions mid-execution.

2. **Event-driven state machine** -- explicit state transitions triggered by events. Powerful but complex to implement and debug. State explosion becomes a problem as the number of step types and transitions grows.

3. **Promise chains with callbacks** -- streaming via callbacks at each stage. Works but leads to deeply nested code and makes error handling across steps inconsistent.

4. **Async generators** -- each execution step `yield`s its result, allowing the consumer to stream results, pause between steps, inject decisions, and handle errors uniformly. The execution function is a single linear flow that reads naturally despite being interruptible.

Key requirements:

- **Streaming** -- users must see step-by-step progress in real time via WebSocket.
- **Pause/resume** -- users can pause a running task and resume it later.
- **Human-in-the-loop** -- at certain checkpoints (e.g., plan approval, destructive action confirmation), execution must pause and wait for user input before continuing.
- **Cancellation** -- users can cancel a running task at any point. Resources (sandbox containers, model API calls) must be cleaned up.
- **Error recovery** -- if a single step fails, the engine should be able to retry or skip rather than aborting the entire task.

## Decision

Use async generators (`async function*`) as the core execution pattern in the Orchestrator service.

The execution engine is structured as follows:

```typescript
async function* executeTask(task: Task, context: ExecutionContext) {
  yield { type: "planning", status: "started" };
  const plan = await generatePlan(task, context);
  yield { type: "planning", status: "completed", plan };

  if (plan.requiresApproval) {
    yield { type: "checkpoint", action: "approve_plan", plan };
    // Consumer injects approval/rejection before resuming
  }

  for (const step of plan.steps) {
    yield { type: "step", status: "started", step };
    const result = await executeStep(step, context);
    yield { type: "step", status: "completed", step, result };
  }

  yield { type: "completed", summary: buildSummary(results) };
}
```

The consumer (orchestrator loop) iterates over the generator, forwarding each yielded value to the WebSocket for real-time streaming. Between iterations, it checks for pause/cancel signals from Redis. At checkpoint yields, it suspends the generator and waits for user input before calling `next()`.

The generator's natural backpressure ensures that steps execute one at a time in sequence, while the yielding mechanism provides clean interruptibility without callbacks or complex state machines.

## Consequences

### Positive

- **Linear readable code** -- the execution flow reads top-to-bottom as a single function, despite being interruptible at every yield point. New developers can understand the execution order by reading one function.
- **Natural streaming** -- each `yield` produces an event that maps directly to a WebSocket message. No separate event emission system is needed.
- **Built-in pause/resume** -- the generator's execution suspends at each `yield`. The consumer controls when to call `next()`, making pause trivially a matter of not calling `next()` until resumed.
- **Clean cancellation** -- calling `generator.return()` terminates the generator and runs any `finally` blocks, providing a clean cancellation mechanism with guaranteed cleanup.
- **Composability** -- generators can delegate to sub-generators via `yield*`, enabling complex multi-phase execution flows to be composed from simpler building blocks.
- **Type safety** -- TypeScript's `AsyncGenerator<YieldType, ReturnType, NextType>` provides full type checking on yielded events, return values, and injected inputs.

### Negative

- **Serialization constraints** -- generator state cannot be serialized to disk or database. If the orchestrator process crashes mid-execution, the task must be restarted from the beginning (or from the last persisted checkpoint). This is mitigated by persisting step results to the database after each yield.
- **Single-process execution** -- a running generator is tied to the process that created it. Horizontal scaling requires task-level partitioning (each task runs on one orchestrator instance), not step-level distribution.
- **Testing complexity** -- testing generators requires iterating through yields and asserting on each step. Helper utilities are needed to make generator-based tests readable.
- **Error handling nuance** -- errors thrown inside the generator propagate to the consumer via the iterator protocol. Developers must understand that `try/catch` inside the generator catches step-level errors, while the consumer's `try/catch` catches generator-level errors.
