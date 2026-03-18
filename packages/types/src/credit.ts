import type { CreditTransactionType } from "./enums";

export interface CreditTransaction {
  id: string;
  orgId: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  taskId: string | null;
  description: string;
  createdAt: Date;
}

export interface CreditBalance {
  orgId: string;
  balance: number;
  reserved: number;
  updatedAt: Date;
}

export interface CreditReservation {
  id: string;
  orgId: string;
  taskId: string;
  amount: number;
  status: "active" | "committed" | "released";
  createdAt: Date;
  expiresAt: Date;
}
