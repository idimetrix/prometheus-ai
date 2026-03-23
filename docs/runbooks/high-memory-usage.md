# Runbook: HighMemoryUsage

## Alert

**Name:** HighMemoryUsage
**Severity:** Warning / Critical
**Threshold:** Warning at 80% memory utilization, Critical at 90%
**Duration:** Fires after sustained usage for 5 minutes

## Detection

This alert fires when a service pod or node exceeds the configured memory threshold. It is typically triggered by Prometheus alerting rules defined in `infra/monitoring/alert_rules.yml`.

## Investigation Steps

1. **Identify the affected service**
   ```bash
   kubectl top pods -n prometheus --sort-by=memory
   ```

2. **Check recent deployments** — a new release may have introduced a memory leak.
   ```bash
   kubectl rollout history deployment/<service> -n prometheus
   ```

3. **Inspect container metrics in Grafana**
   - Open the "System Overview" dashboard.
   - Filter by the affected pod/service.
   - Look for a monotonically increasing RSS curve (leak indicator).

4. **Review application logs for OOM warnings**
   ```bash
   kubectl logs <pod> -n prometheus --tail=500 | grep -i "heap\|oom\|memory"
   ```

5. **Take a heap snapshot** (Node.js services)
   ```bash
   kubectl exec <pod> -n prometheus -- kill -USR2 1
   ```

## Resolution

- **Short-term:** Restart the affected pods to reclaim memory.
  ```bash
  kubectl rollout restart deployment/<service> -n prometheus
  ```
- **If a leak is confirmed:** Roll back to the last known good release.
  ```bash
  kubectl rollout undo deployment/<service> -n prometheus
  ```
- **Increase limits** temporarily if the workload is legitimately higher.

## Prevention

- Run load tests with memory profiling before deploying memory-intensive changes.
- Set appropriate `resources.limits.memory` in Kubernetes manifests.
- Enable Node.js `--max-old-space-size` flags in Dockerfiles.
- Monitor memory trends weekly via the Grafana "System Overview" dashboard.
