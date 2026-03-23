"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import { Check, CreditCard, Sparkles, Zap } from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditPack {
  credits: number;
  id: string;
  name: string;
  perCreditCents: number;
  priceUsd: number;
}

export interface CreditPackSelectorProps {
  /** Current credit balance */
  currentBalance?: number;
  /** Whether a purchase is in progress */
  isPurchasing?: boolean;
  /** New balance after purchase */
  newBalance?: number;
  /** Callback when a pack is selected for purchase */
  onPurchase: (packId: string) => Promise<void>;
  /** Available credit packs from the API */
  packs: CreditPack[];
  /** Whether the purchase just completed */
  purchaseComplete?: boolean;
}

// ---------------------------------------------------------------------------
// Pack icon helper
// ---------------------------------------------------------------------------

function getPackIcon(credits: number) {
  if (credits >= 2000) {
    return <Sparkles className="h-5 w-5 text-yellow-500" />;
  }
  if (credits >= 750) {
    return <Zap className="h-5 w-5 text-purple-500" />;
  }
  return <CreditCard className="h-5 w-5 text-blue-500" />;
}

function getSavingsLabel(pack: CreditPack, baseCents: number): string | null {
  if (pack.perCreditCents >= baseCents) {
    return null;
  }
  const savings = Math.round(
    ((baseCents - pack.perCreditCents) / baseCents) * 100
  );
  if (savings <= 0) {
    return null;
  }
  return `Save ${savings}%`;
}

function getButtonLabel(
  selectedPackId: string | null,
  packs: CreditPack[]
): string {
  if (!selectedPackId) {
    return "Select a pack";
  }
  const packName =
    packs.find((p) => p.id === selectedPackId)?.name ?? "Credits";
  return `Purchase ${packName}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreditPackSelector({
  packs,
  currentBalance,
  onPurchase,
  isPurchasing = false,
  purchaseComplete = false,
  newBalance,
}: CreditPackSelectorProps) {
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const handlePurchase = useCallback(async () => {
    if (!selectedPackId || isPurchasing) {
      return;
    }
    await onPurchase(selectedPackId);
  }, [selectedPackId, isPurchasing, onPurchase]);

  // Use the first pack's per-credit cost as the base for savings calculations
  const baseCentsPerCredit = packs[0]?.perCreditCents ?? 10;

  if (purchaseComplete) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="font-semibold text-lg">Purchase Complete</h3>
          <p className="text-muted-foreground text-sm">
            Your credits have been added to your account.
          </p>
          {newBalance != null && (
            <p className="font-bold text-2xl">
              New Balance: {newBalance.toLocaleString()} credits
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {currentBalance != null && (
        <div className="text-muted-foreground text-sm">
          Current balance:{" "}
          <span className="font-semibold text-foreground">
            {currentBalance.toLocaleString()} credits
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {packs.map((pack) => {
          const isSelected = selectedPackId === pack.id;
          const savingsLabel = getSavingsLabel(pack, baseCentsPerCredit);

          return (
            <button
              className={`relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              } ${isPurchasing ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              disabled={isPurchasing}
              key={pack.id}
              onClick={() => setSelectedPackId(pack.id)}
              type="button"
            >
              {savingsLabel && (
                <Badge
                  className="absolute -top-2 right-2 text-xs"
                  variant="secondary"
                >
                  {savingsLabel}
                </Badge>
              )}

              {getPackIcon(pack.credits)}

              <span className="font-bold text-lg">
                {pack.credits.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-xs">credits</span>

              <span className="font-semibold text-base">${pack.priceUsd}</span>
              <span className="text-muted-foreground text-xs">
                ${(pack.perCreditCents / 100).toFixed(3)}/credit
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-muted-foreground text-xs">
          Credits are non-refundable and do not expire.
        </p>
        <Button
          disabled={!selectedPackId || isPurchasing}
          onClick={handlePurchase}
        >
          {isPurchasing
            ? "Processing..."
            : getButtonLabel(selectedPackId, packs)}
        </Button>
      </div>
    </div>
  );
}
