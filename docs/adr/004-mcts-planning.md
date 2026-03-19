# ADR-004: Monte Carlo Tree Search for Planning

## Status

Accepted

## Context

When a user submits a task like "add authentication to the API," the orchestrator must decompose it into a sequence of concrete steps: analyze the codebase, identify integration points, generate code for middleware, update routes, write tests, and so on. The quality of this plan directly determines the quality of the final output.

Several planning strategies were evaluated:

1. **Single-shot LLM planning** -- ask the model to produce a complete plan in one call. Fast and simple, but the model has no opportunity to evaluate alternatives or recover from a poor initial decomposition. Plans tend to be superficial and miss edge cases.

2. **Chain-of-thought decomposition** -- use multi-step prompting to iteratively refine the plan. Better than single-shot but still fundamentally linear -- it explores one path and commits to it. No mechanism for comparing alternative approaches.

3. **Beam search** -- generate multiple candidate plans in parallel and score them. Better exploration than single-path, but the number of candidates is fixed upfront and scoring is done only at the plan level, not at intermediate steps.

4. **Monte Carlo Tree Search (MCTS)** -- model the planning problem as a tree where nodes are partial plans and edges are individual steps. Use simulated rollouts to estimate the value of each partial plan, then expand the most promising branches. This provides principled exploration-exploitation tradeoff with the ability to evaluate plans at every intermediate stage.

Key requirements:

- **Quality over speed** -- for complex tasks, spending 30-60 seconds on planning to produce a high-quality plan is preferable to instantly producing a mediocre one.
- **Alternative exploration** -- the planner should consider multiple approaches (e.g., "use middleware vs. use a decorator pattern") and select the best one based on evaluation.
- **Adaptive depth** -- simple tasks should produce short plans quickly; complex tasks should explore deeper trees with more alternatives.
- **Explainability** -- users can request to see why a particular plan was chosen, including what alternatives were considered and why they were rejected.

## Decision

Use Monte Carlo Tree Search (MCTS) as the planning algorithm in the Orchestrator, adapted for LLM-based plan generation.

The MCTS implementation follows the standard four-phase loop:

1. **Selection** -- starting from the root (empty plan), traverse the tree by selecting child nodes using the UCB1 formula, which balances exploitation (high-value nodes) with exploration (under-visited nodes).

2. **Expansion** -- at a leaf node, use the LLM to generate 2-4 candidate next steps. Each candidate becomes a child node in the tree. The prompt includes the partial plan so far, the project context from Project Brain, and the original task description.

3. **Simulation (rollout)** -- from each new child node, use a fast model (the `fast` slot) to simulate completing the plan to the end. The simulated plan is not executed -- it is only used for evaluation.

4. **Backpropagation** -- evaluate the completed simulated plan using a scoring function that considers feasibility, completeness, estimated cost, and alignment with project conventions. Propagate the score back up the tree to update node values.

After a configurable number of iterations (default: 50 for complex tasks, 10 for simple ones), the algorithm extracts the highest-value path from root to leaf as the final plan.

Adaptations for the LLM planning domain:

- **Context injection** -- each node expansion includes relevant project context (blueprint, conventions, file structure) from Project Brain, ensuring plans are grounded in the actual codebase.
- **Cost-aware scoring** -- the evaluation function penalizes plans that require many expensive model calls, incentivizing efficient approaches.
- **Early termination** -- if a high-confidence plan is found quickly (score above threshold), the search terminates early rather than exhausting the iteration budget.
- **Plan caching** -- similar tasks reuse subtrees from previous planning sessions via episodic memory, accelerating convergence for recurring task patterns.

## Consequences

### Positive

- **Higher plan quality** -- by exploring multiple decomposition strategies and evaluating them against simulated outcomes, MCTS consistently produces more thorough and robust plans than single-shot or linear planning.
- **Principled exploration** -- UCB1 ensures that the planner does not get stuck on the first reasonable approach. Alternative strategies are explored proportionally to their potential value.
- **Adaptive complexity** -- the iteration budget scales with task complexity. Simple tasks converge in a few iterations; complex tasks benefit from deeper exploration. Early termination prevents wasted computation on easy problems.
- **Explainable decisions** -- the tree structure provides a natural explanation: "I considered approaches A, B, and C. Approach A scored highest because it reuses existing middleware and requires fewer file changes."
- **Incremental improvement** -- the scoring function can be tuned independently of the tree search algorithm. Better evaluation heuristics directly improve plan quality without changing the search mechanism.

### Negative

- **Latency** -- MCTS planning is inherently slower than single-shot planning. Each iteration requires at least one LLM call for expansion and one for simulation. With 50 iterations using the fast model, planning may take 30-60 seconds. This is acceptable for complex tasks but must be configurable for quick tasks.
- **Cost** -- each MCTS iteration consumes LLM tokens. Planning a complex task may use hundreds of thousands of tokens across all iterations. The cost-aware scoring partially mitigates this by penalizing expensive plans, but the planning process itself has a non-trivial cost.
- **Implementation complexity** -- MCTS requires maintaining a tree data structure, implementing UCB1, managing concurrent LLM calls during expansion, and designing an effective scoring function. The algorithm is well-understood in game-playing AI but less common in LLM applications, so the team had a learning curve.
- **Non-determinism** -- MCTS is inherently stochastic. The same task may produce different plans on different runs. This is generally acceptable (multiple valid plans exist for most tasks) but can be surprising when debugging.
- **Simulation fidelity** -- the quality of MCTS depends on the simulation rollouts being predictive of actual execution success. If the fast model's simulated plans are poor predictors, the tree search optimizes for the wrong objective. The simulation model must be calibrated periodically.
