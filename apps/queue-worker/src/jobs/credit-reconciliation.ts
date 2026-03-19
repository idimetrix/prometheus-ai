import { creditBalances, creditTransactions, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { sql } from "drizzle-orm";

const logger = createLogger("queue-worker:credit-reconciliation");

const MISMATCH_ALERT_THRESHOLD = 100;

interface ReconciliationResult {
  corrected: number;
  mismatches: number;
  orgsChecked: number;
}

/**
 * For each org: compute SUM(amount) from transactions, compare with balance.
 * Auto-correct if mismatch < 100 credits. Alert if >= 100.
 */
export async function processCreditReconciliation(): Promise<ReconciliationResult> {
  logger.info("Starting credit reconciliation");

  const balances = await db.select().from(creditBalances);
  let mismatches = 0;
  let corrected = 0;

  for (const bal of balances) {
    const [sumRow] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${creditTransactions.amount}), 0)`,
      })
      .from(creditTransactions)
      .where(sql`${creditTransactions.orgId} = ${bal.orgId}`);

    const computedBalance = Number(sumRow?.total ?? 0);
    const currentBalance = bal.balance;
    const diff = Math.abs(computedBalance - currentBalance);

    if (diff === 0) {
      continue;
    }

    mismatches++;

    if (diff < MISMATCH_ALERT_THRESHOLD) {
      // Auto-correct small mismatches
      await db
        .update(creditBalances)
        .set({ balance: computedBalance, updatedAt: new Date() })
        .where(sql`${creditBalances.orgId} = ${bal.orgId}`);

      corrected++;
      logger.info(
        { orgId: bal.orgId, diff, old: currentBalance, new: computedBalance },
        "Credit balance auto-corrected"
      );
    } else {
      // Alert for large mismatches
      logger.error(
        {
          orgId: bal.orgId,
          diff,
          current: currentBalance,
          computed: computedBalance,
        },
        "Large credit balance mismatch detected — requires manual review"
      );
    }
  }

  logger.info(
    { orgsChecked: balances.length, mismatches, corrected },
    "Credit reconciliation complete"
  );

  return { orgsChecked: balances.length, mismatches, corrected };
}
