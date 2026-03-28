/**
 * GAP-104: Natural Language Monitoring
 *
 * Converts natural language queries like "Show me error rates for
 * the last hour" into Grafana/Datadog queries and returns formatted results.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:nl-monitoring");

export interface MonitoringQuery {
  platform: "grafana" | "datadog" | "prometheus";
  query: string;
  timeRange: { from: string; to: string };
}

export interface MonitoringResult {
  data: Array<{ timestamp: string; value: number; label: string }>;
  query: MonitoringQuery;
  summary: string;
}

const METRIC_PATTERNS: Array<{
  pattern: RegExp;
  metric: string;
  promQuery: string;
}> = [
  {
    pattern: /error\s*rate/i,
    metric: "error_rate",
    promQuery:
      'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
  },
  {
    pattern: /request\s*(count|volume|rate)/i,
    metric: "request_rate",
    promQuery: "sum(rate(http_requests_total[5m]))",
  },
  {
    pattern: /latency|response\s*time/i,
    metric: "latency",
    promQuery:
      "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))",
  },
  {
    pattern: /cpu\s*(usage|utilization)/i,
    metric: "cpu_usage",
    promQuery:
      '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  },
  {
    pattern: /memory\s*(usage|utilization)/i,
    metric: "memory_usage",
    promQuery:
      "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100",
  },
];

const TIME_PATTERNS: Array<{ pattern: RegExp; minutes: number }> = [
  { pattern: /last\s*(\d+)\s*minute/i, minutes: 0 },
  { pattern: /last\s*hour/i, minutes: 60 },
  { pattern: /last\s*(\d+)\s*hour/i, minutes: 0 },
  { pattern: /last\s*day|last\s*24/i, minutes: 1440 },
  { pattern: /last\s*week/i, minutes: 10_080 },
];

export class NLMonitoringConverter {
  /**
   * Convert a natural language monitoring query to a structured query.
   */
  convert(question: string): MonitoringQuery {
    const metric = this.detectMetric(question);
    const timeRange = this.detectTimeRange(question);

    const query: MonitoringQuery = {
      platform: "prometheus",
      query: metric.promQuery,
      timeRange,
    };

    logger.info(
      {
        question: question.slice(0, 80),
        metric: metric.metric,
        platform: query.platform,
      },
      "NL monitoring query converted"
    );

    return query;
  }

  /**
   * Format monitoring results into a human-readable summary.
   */
  formatResults(result: MonitoringResult): string {
    if (result.data.length === 0) {
      return "No data found for the specified query and time range.";
    }

    const values = result.data.map((d) => d.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);

    return `${result.summary}\n\nAverage: ${avg.toFixed(2)}, Min: ${min.toFixed(2)}, Max: ${max.toFixed(2)}\nData points: ${result.data.length}`;
  }

  private detectMetric(question: string): {
    metric: string;
    promQuery: string;
  } {
    for (const { pattern, metric, promQuery } of METRIC_PATTERNS) {
      if (pattern.test(question)) {
        return { metric, promQuery };
      }
    }
    return { metric: "unknown", promQuery: "up" };
  }

  private detectTimeRange(question: string): { from: string; to: string } {
    const now = new Date();
    let minutes = 60; // Default: last hour

    for (const { pattern, minutes: mins } of TIME_PATTERNS) {
      const match = question.match(pattern);
      if (match) {
        if (mins > 0) {
          minutes = mins;
        } else if (match[1]) {
          const num = Number.parseInt(match[1], 10);
          if (pattern.source.includes("hour")) {
            minutes = num * 60;
          } else {
            minutes = num;
          }
        }
        break;
      }
    }

    const from = new Date(now.getTime() - minutes * 60 * 1000);
    return {
      from: from.toISOString(),
      to: now.toISOString(),
    };
  }
}
