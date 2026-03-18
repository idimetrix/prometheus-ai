import { creditBalances, creditTransactions, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { CreditGrantData } from "@prometheus/queue";
import { EventPublisher } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq, sql } from "drizzle-orm";

const logger = createLogger("queue-worker:credit-grant");
const publisher = new EventPublisher();

export async function processCreditGrant(
  data: CreditGrantData
): Promise<{ transactionId: string; newBalance: number }> {
  const { orgId, amount, reason, planTier, periodStart, periodEnd } = data;

  logger.info({ orgId, amount, reason, planTier }, "Processing credit grant");

  // Add credits to balance
  const existingBalance = await db.query.creditBalances.findFirst({
    where: eq(creditBalances.orgId, orgId),
  });

  let newBalance: number;

  if (existingBalance) {
    await db
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, orgId));

    newBalance = existingBalance.balance + amount;
  } else {
    // Create balance record if it doesn't exist
    await db.insert(creditBalances).values({
      orgId,
      balance: amount,
      reserved: 0,
      updatedAt: new Date(),
    });
    newBalance = amount;
  }

  // Record the transaction
  const transactionId = generateId("ctx");
  await db.insert(creditTransactions).values({
    id: transactionId,
    orgId,
    type: (() => {
      if (reason === "refund") {
        return "refund" as const;
      }
      if (reason === "bonus") {
        return "bonus" as const;
      }
      return "subscription_grant" as const;
    })(),
    amount,
    balanceAfter: newBalance,
    description: buildDescription(
      reason,
      amount,
      planTier,
      periodStart,
      periodEnd
    ),
  });

  logger.info(
    { orgId, transactionId, newBalance, reason },
    "Credit grant processed"
  );

  // Publish notification if this is a subscription grant
  if (reason === "subscription_monthly") {
    try {
      await publisher.publishFleetEvent(orgId, {
        type: "credit_update",
        data: {
          balance: newBalance,
          granted: amount,
          reason,
          planTier,
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-critical
    }
  }

  return { transactionId, newBalance };
}

function buildDescription(
  reason: string,
  amount: number,
  planTier: string,
  periodStart: string,
  periodEnd: string
): string {
  switch (reason) {
    case "subscription_monthly":
      return `Monthly ${planTier} plan grant: ${amount} credits (${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)})`;
    case "bonus":
      return `Bonus credit grant: ${amount} credits`;
    case "refund":
      return `Credit refund: ${amount} credits`;
    case "manual":
      return `Manual credit adjustment: ${amount} credits`;
    default:
      return `Credit grant: ${amount} credits (${reason})`;
  }
}
