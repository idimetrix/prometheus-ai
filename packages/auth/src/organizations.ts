import type { OrgRole } from "./server";

// ---------------------------------------------------------------------------
// Organization management helpers
// ---------------------------------------------------------------------------

/**
 * Utility type for org membership record as returned from the DB.
 */
export interface OrgMembership {
  joinedAt: Date | null;
  orgId: string;
  role: OrgRole;
  userId: string;
}

/**
 * Parameters for creating a new organization via Clerk + local DB.
 */
export interface CreateOrgParams {
  createdByUserId: string;
  name: string;
  slug: string;
}

/**
 * Parameters for inviting a member to an organization.
 */
export interface InviteMemberParams {
  email: string;
  invitedByUserId: string;
  orgId: string;
  role: OrgRole;
}

/**
 * Parameters for removing a member from an organization.
 */
export interface RemoveMemberParams {
  orgId: string;
  removedByUserId: string;
  userId: string;
}

/**
 * Parameters for updating a member's role.
 */
export interface UpdateMemberRoleParams {
  newRole: OrgRole;
  orgId: string;
  updatedByUserId: string;
  userId: string;
}

/**
 * Parameters for switching the active organization in a session.
 */
export interface SwitchOrgParams {
  targetOrgId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

/**
 * Check whether a given org role can manage members (invite/remove/change roles).
 * Only admin and owner can manage members.
 */
export function canManageMembers(role: OrgRole | null): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Check whether a given org role can manage org settings (name, slug, billing).
 * Only admin and owner can change settings.
 */
export function canManageOrgSettings(role: OrgRole | null): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Check whether a given org role can manage billing.
 * Only owner can manage billing.
 */
export function canManageBilling(role: OrgRole | null): boolean {
  return role === "owner";
}

/**
 * Check whether a given org role can delete the organization.
 * Only owner can delete.
 */
export function canDeleteOrg(role: OrgRole | null): boolean {
  return role === "owner";
}
