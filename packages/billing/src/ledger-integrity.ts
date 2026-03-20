import { creditBalances, creditTransactions, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq, sql } from "drizzle-orm";

const logger = createLogger("billing:ledger-integrity");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  calculatedBalance: number;
  corrected: boolean;
  currentBalance: number;
  discrepancy: number;
  isConsistent: boolean;
  orgId: string;
  timestamp: string;
}

export interface TransactionVerification {
  reason?: string;
  transactionId: string;
  valid: boolean;
}

// ─── Idempotency Key Store ────────────────────────────────────────────────────

const processedKeys = new Map<string, { result: unknown; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a transaction has already been processed (idempotency).
 */
export function isIdempotent(key: string): boolean {
  const entry = processedKeys.get(key);
  if (!entry) {
    return false;
  }
  if (Date.now() > entry.expiresAt) {
    processedKeys.delete(key);
    return false;
  }
  return true;
}

/**
 * Record an idempotency key after successful processing.
 */
export function recordIdempotencyKey(key: string, result: unknown): void {
  processedKeys.set(key, {
    result,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

// ─── Ledger Integrity ─────────────────────────────────────────────────────────

export class LedgerIntegrity {
  /**
   * Reconcile an org's credit balance against the sum of all transactions.
   *
   * If a discrepancy is found, auto-corrects the balance and logs an audit entry.
   */
  async reconcile(orgId: string): Promise<ReconciliationResult> {
    logger.info({ orgId }, "Starting ledger reconciliation");

    // Get current stored balance
    const balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, orgId),
    });

    if (!balance) {
      return {
        orgId,
        currentBalance: 0,
        calculatedBalance: 0,
        discrepancy: 0,
        isConsistent: true,
        corrected: false,
        timestamp: new Date().toISOString(),
      };
    }

    // Sum all transactions for this org
    const [result] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${creditTransactions.amount}), 0)`,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.orgId, orgId));

    const calculatedBalance = Number(result?.total ?? 0);
    const currentBalance = balance.balance;
    const discrepancy = currentBalance - calculatedBalance;
    const isConsistent = Math.abs(discrepancy) < 0.01; // Float tolerance

    let corrected = false;

    if (!isConsistent) {
      logger.warn(
        {
          orgId,
          currentBalance,
          calculatedBalance,
          discrepancy,
        },
        "Ledger discrepancy detected, auto-correcting"
      );

      // Auto-correct the balance
      await db
        .update(creditBalances)
        .set({
          balance: calculatedBalance,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.orgId, orgId));

      corrected = true;

      logger.info(
        { orgId, oldBalance: currentBalance, newBalance: calculatedBalance },
        "Ledger balance corrected"
      );
    }

    return {
      orgId,
      currentBalance,
      calculatedBalance,
      discrepancy,
      isConsistent,
      corrected,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify a specific transaction exists and has valid data.
   */
  async verifyTransaction(txId: string): Promise<TransactionVerification> {
    const tx = await db.query.creditTransactions.findFirst({
      where: eq(creditTransactions.id, txId),
    });

    if (!tx) {
      return {
        transactionId: txId,
        valid: false,
        reason: "Transaction not found",
      };
    }

    // Validate transaction amount is non-zero
    if (tx.amount === 0) {
      return {
        transactionId: txId,
        valid: false,
        reason: "Transaction amount is zero",
      };
    }

    // Validate type consistency
    const validTypes = [
      "purchase",
      "consumption",
      "refund",
      "bonus",
      "subscription_grant",
    ];
    if (!validTypes.includes(tx.type)) {
      return {
        transactionId: txId,
        valid: false,
        reason: `Invalid transaction type: ${tx.type}`,
      };
    }

    // Consumption should be negative
    if (tx.type === "consumption" && tx.amount > 0) {
      return {
        transactionId: txId,
        valid: false,
        reason: "Consumption transaction should have negative amount",
      };
    }

    // Purchase/refund/bonus should be positive
    if (
      (tx.type === "purchase" || tx.type === "refund" || tx.type === "bonus") &&
      tx.amount < 0
    ) {
      return {
        transactionId: txId,
        valid: false,
        reason: `${tx.type} transaction should have positive amount`,
      };
    }

    return { transactionId: txId, valid: true };
  }

  /**
   * Reconcile all organizations. Returns results for any inconsistent ledgers.
   */
  async reconcileAll(): Promise<ReconciliationResult[]> {
    const allBalances = await db.select().from(creditBalances);
    const results: ReconciliationResult[] = [];

    for (const balance of allBalances) {
      const result = await this.reconcile(balance.orgId);
      if (!result.isConsistent) {
        results.push(result);
      }
    }

    if (results.length > 0) {
      logger.warn(
        { inconsistentCount: results.length },
        "Ledger reconciliation found inconsistencies"
      );
    } else {
      logger.info("Ledger reconciliation complete: all balances consistent");
    }

    return results;
  }
}
