import type { CreditTransactionType } from "./enums";

export interface CreditTransaction {
  amount: number;
  balanceAfter: number;
  createdAt: Date;
  description: string;
  id: string;
  orgId: string;
  taskId: string | null;
  type: CreditTransactionType;
}

export interface CreditBalance {
  balance: number;
  orgId: string;
  reserved: number;
  updatedAt: Date;
}

export interface CreditReservation {
  amount: number;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  orgId: string;
  status: "active" | "committed" | "released";
  taskId: string;
}
