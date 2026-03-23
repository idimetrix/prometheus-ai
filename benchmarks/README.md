# Prometheus Benchmarks

Automated benchmark suite for measuring Prometheus platform performance against standard coding benchmarks.

## Benchmarks

### SWE-bench Lite

[SWE-bench](https://www.swebench.com/) evaluates an AI system's ability to resolve real-world GitHub issues. SWE-bench Lite is a curated subset of 300 representative tasks.

**What it measures:**
- End-to-end issue resolution (reading issue, understanding codebase, generating patch)
- Pass rate: percentage of tasks where the generated patch passes all tests
- Average time per task and total cost

**Running:**
```bash
./scripts/run-swe-bench.sh
```

### HumanEval

[HumanEval](https://github.com/openai/human-eval) is a benchmark of 164 hand-written Python programming problems.

**What it measures:**
- Code generation accuracy (pass@1)
- Average generation time per problem
- Total cost

**Running:**
```bash
./scripts/run-humaneval.sh
```

## Results

Results are stored in `benchmarks/results/` as timestamped JSON files:

- `swe-bench-YYYY-MM-DD.json` — SWE-bench Lite results
- `humaneval-YYYY-MM-DD.json` — HumanEval results

## CI Integration

Benchmarks run automatically via `.github/workflows/benchmarks.yml`:

- **Schedule:** Weekly on Sunday at 2:00 AM UTC
- **Trigger:** Can also be triggered manually via `workflow_dispatch`
- Results are uploaded as workflow artifacts
- Significant regressions (>5% drop in pass rate) are flagged

## Methodology

1. **Isolation:** Each benchmark run uses a fresh environment with no cached results.
2. **Model consistency:** The same model configuration is used across runs for comparability.
3. **Cost tracking:** Token usage and API costs are recorded per task.
4. **Reproducibility:** All configuration (model, temperature, max tokens) is logged with results.
