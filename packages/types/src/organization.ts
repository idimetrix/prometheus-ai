import type { PlanTier } from "./enums";

export interface Organization {
  createdAt: Date;
  id: string;
  name: string;
  planTier: PlanTier;
  slug: string;
  stripeCustomerId: string | null;
  updatedAt: Date;
}

export interface OrgMember {
  invitedAt: Date;
  joinedAt: Date | null;
  orgId: string;
  role: "owner" | "admin" | "member";
  userId: string;
}
