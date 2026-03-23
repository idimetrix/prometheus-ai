# Runbook: QueueDepthCritical

## Alert

**Name:** QueueDepthCritical
**Severity:** Critical
**Threshold:** Waiting job count exceeds 500 for longer than 3 minutes
**Source:** BullMQ queue metrics exported to Prometheus

## Detection

This alert fires when the task queue depth grows beyond acceptable limits, indicating that workers are unable to keep pace with incoming jobs.

## Investigation Steps

1. **Check queue metrics**
   ```bash
   curl -s http://localhost:4000/api/trpc/queue.getStats | jq
   ```

2. **Verify worker health**
   ```bash
   kubectl get pods -n prometheus -l app=queue-worker
   kubectl logs -l app=queue-worker -n prometheus --tail=200
   ```

3. **Check Redis connectivity** — workers depend on Redis for job coordination.
   ```bash
   kubectl exec -it redis-0 -n prometheus -- redis-cli ping
   redis-cli -h <redis-host> llen bull:tasks:wait
   ```

4. **Look for stuck or failed jobs**
   ```bash
   redis-cli -h <redis-host> llen bull:tasks:failed
   ```

5. **Review recent changes** — a new job type or a slow external dependency can cause backup.

## Resolution

- **Scale workers horizontally:**
  ```bash
  kubectl scale deployment/queue-worker -n prometheus --replicas=5
  ```
- **Clear stuck/failed jobs** (if safe to retry):
  ```bash
  # Via the Prometheus API
  curl -X POST http://localhost:4000/api/trpc/queue.retryAll
  ```
- **Restart workers** if they are unhealthy:
  ```bash
  kubectl rollout restart deployment/queue-worker -n prometheus
  ```
- **If Redis is the bottleneck:** Check Redis memory and connection limits.

## Prevention

- Set up autoscaling for queue-worker pods based on queue depth metrics.
- Configure job TTL and max retries to prevent infinite requeuing.
- Monitor the "Queue Health" Grafana dashboard daily.
- Load-test queue throughput before adding new high-volume job types.
