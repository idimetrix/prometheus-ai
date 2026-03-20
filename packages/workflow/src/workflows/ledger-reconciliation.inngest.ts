import type { ReconciliationResult } from "@prometheus/billing/ledger-integrity";
import { LedgerIntegrity } from "@prometheus/billing/ledger-integrity";
import { createLogger } from "@prometheus/logger";
import { inngest } from "../inngest";

const logger = createLogger("workflow:ledger-reconciliation");
const ledger = new LedgerIntegrity();

// ---------------------------------------------------------------------------
// Serializable result type for Inngest step data
// ---------------------------------------------------------------------------

interface DiscrepancyRecord {
  calculatedBalance: number;
  corrected: boolean;
  currentBalance: number;
  discrepancy: number;
  orgId: string;
  timestamp: string;
}

function toDiscrepancyRecord(r: ReconciliationResult): DiscrepancyRecord {
  return {
    orgId: r.orgId,
    currentBalance: r.currentBalance,
    calculatedBalance: r.calculatedBalance,
    discrepancy: r.discrepancy,
    corrected: r.corrected,
    timestamp: r.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Ledger Reconciliation Cron Workflow
// ---------------------------------------------------------------------------

/**
 * Scheduled ledger reconciliation workflow.
 * Runs every 6 hours via Inngest cron to verify all org credit balances
 * match their transaction history. Auto-corrects small discrepancies
 * and alerts on larger ones.
 */
export const ledgerReconciliationCron: ReturnType<
  typeof inngest.createFunction
> = inngest.createFunction(
  {
    id: "ledger-reconciliation-cron",
    name: "Ledger Reconciliation (Scheduled)",
    retries: 2,
    triggers: [
      {
        cron: "0 */6 * * *", // Every 6 hours
      },
    ],
  },
  async ({ step }) => {
    logger.info("Starting scheduled ledger reconciliation");

    // Run the full reconciliation
    const results: DiscrepancyRecord[] = await step.run(
      "reconcile-all",
      async () => {
        const discrepancies = await ledger.reconcileAll();
        return discrepancies.map(toDiscrepancyRecord);
      }
    );

    // If discrepancies were found, emit an alert event
    if (results.length > 0) {
      await step.run("alert-discrepancies", () => {
        logger.warn(
          {
            discrepancyCount: results.length,
            discrepancies: results,
          },
          "Ledger reconciliation found discrepancies"
        );

        return {
          alerted: true,
          discrepancyCount: results.length,
        };
      });

      // Emit event for each discrepancy (can be picked up by notification workflows)
      for (const result of results) {
        await step.sendEvent(`alert-${result.orgId}`, {
          name: "prometheus/billing.ledger.discrepancy",
          data: {
            orgId: result.orgId,
            currentBalance: result.currentBalance,
            calculatedBalance: result.calculatedBalance,
            discrepancy: result.discrepancy,
            corrected: result.corrected,
            timestamp: result.timestamp,
          },
        });
      }
    }

    const correctedCount = results.filter(
      (r: DiscrepancyRecord) => r.corrected
    ).length;

    logger.info(
      {
        discrepanciesFound: results.length,
        corrected: correctedCount,
      },
      "Ledger reconciliation complete"
    );

    return {
      success: true,
      discrepanciesFound: results.length,
      corrected: correctedCount,
      results,
    };
  }
);

/**
 * Manual trigger for ledger reconciliation.
 * Can be invoked via Inngest dashboard or API for ad-hoc reconciliation.
 */
export const ledgerReconciliationManual: ReturnType<
  typeof inngest.createFunction
> = inngest.createFunction(
  {
    id: "ledger-reconciliation-manual",
    name: "Ledger Reconciliation (Manual Trigger)",
    retries: 1,
    triggers: [
      {
        event: "prometheus/billing.ledger.reconcile",
      },
    ],
  },
  async ({ event, step }) => {
    const orgId = (event.data as { orgId?: string })?.orgId;

    if (orgId) {
      // Reconcile a single org
      logger.info({ orgId }, "Manual ledger reconciliation for single org");

      const result: DiscrepancyRecord = await step.run(
        "reconcile-single",
        async () => {
          const reconciled = await ledger.reconcile(orgId);
          return toDiscrepancyRecord(reconciled);
        }
      );

      if (result.discrepancy !== 0) {
        await step.sendEvent("alert-single-discrepancy", {
          name: "prometheus/billing.ledger.discrepancy",
          data: {
            orgId: result.orgId,
            currentBalance: result.currentBalance,
            calculatedBalance: result.calculatedBalance,
            discrepancy: result.discrepancy,
            corrected: result.corrected,
            timestamp: result.timestamp,
          },
        });
      }

      return {
        success: true,
        orgId,
        result,
      };
    }

    // Reconcile all orgs
    logger.info("Manual ledger reconciliation for all orgs");

    const results: DiscrepancyRecord[] = await step.run(
      "reconcile-all-manual",
      async () => {
        const discrepancies = await ledger.reconcileAll();
        return discrepancies.map(toDiscrepancyRecord);
      }
    );

    const correctedCount = results.filter(
      (r: DiscrepancyRecord) => r.corrected
    ).length;

    return {
      success: true,
      discrepanciesFound: results.length,
      corrected: correctedCount,
    };
  }
);
