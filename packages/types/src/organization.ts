import type { PlanTier } from "./enums";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planTier: PlanTier;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  invitedAt: Date;
  joinedAt: Date | null;
}
