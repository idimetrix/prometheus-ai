# Runbook: APIErrorRateHigh

## Alert

**Name:** APIErrorRateHigh
**Severity:** Critical
**Threshold:** 5xx error rate exceeds 5% of total requests over a 5-minute window
**Source:** HTTP metrics from the API service (apps/api)

## Detection

This alert fires when the API service returns an elevated rate of server errors (HTTP 5xx). It is tracked via Prometheus HTTP request metrics and defined in `infra/monitoring/alert_rules.yml`.

## Investigation Steps

1. **Check API pod health**
   ```bash
   kubectl get pods -n prometheus -l app=api
   kubectl top pods -n prometheus -l app=api
   ```

2. **Tail API logs for errors**
   ```bash
   kubectl logs -l app=api -n prometheus --tail=500 | grep -i "error\|500\|TRPC"
   ```

3. **Check downstream dependencies**
   - Database: `kubectl exec -it postgres-0 -n prometheus -- pg_isready`
   - Redis: `kubectl exec -it redis-0 -n prometheus -- redis-cli ping`
   - Orchestrator: `curl -s http://localhost:4002/health`

4. **Look at Grafana dashboards**
   - Open "Prometheus Overview" dashboard and check the error rate panel.
   - Correlate the spike with deployment times or traffic changes.

5. **Check for database connection exhaustion**
   ```bash
   kubectl logs -l app=api -n prometheus --tail=200 | grep -i "pool\|connection"
   ```

## Resolution

- **Restart API pods** if errors are transient:
  ```bash
  kubectl rollout restart deployment/api -n prometheus
  ```
- **Roll back** if a recent deployment caused the spike:
  ```bash
  kubectl rollout undo deployment/api -n prometheus
  ```
- **Scale up** if the issue is load-related:
  ```bash
  kubectl scale deployment/api -n prometheus --replicas=5
  ```
- **Fix database issues** — increase connection pool size or restart the database if needed.

## Prevention

- Enforce error budget tracking via the SLO definitions in `infra/monitoring/slo-definitions.yaml`.
- Run integration tests before every deployment.
- Set up circuit breakers for downstream service calls.
- Review error logs weekly and address recurring patterns.
