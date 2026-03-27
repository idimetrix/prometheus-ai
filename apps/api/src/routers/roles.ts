import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:roles");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All available permissions in the Prometheus platform. */
const ALL_PERMISSIONS = [
  // Projects
  "projects:read",
  "projects:create",
  "projects:update",
  "projects:delete",
  "projects:archive",
  // Sessions
  "sessions:read",
  "sessions:create",
  "sessions:cancel",
  "sessions:share",
  // Tasks
  "tasks:read",
  "tasks:create",
  "tasks:retry",
  // Deployments
  "deployments:read",
  "deployments:create",
  "deployments:rollback",
  // Secrets
  "secrets:read",
  "secrets:write",
  "secrets:delete",
  // API Keys
  "api_keys:read",
  "api_keys:create",
  "api_keys:revoke",
  // Billing
  "billing:read",
  "billing:manage",
  // Team
  "members:read",
  "members:invite",
  "members:remove",
  "members:update_role",
  // Settings
  "settings:read",
  "settings:update",
  // Integrations
  "integrations:read",
  "integrations:manage",
  // Audit
  "audit:read",
  // Roles
  "roles:read",
  "roles:manage",
] as const;

type Permission = (typeof ALL_PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Built-in roles
// ---------------------------------------------------------------------------

export interface Role {
  createdAt: string;
  createdBy: string | null;
  description: string;
  id: string;
  isBuiltIn: boolean;
  name: string;
  orgId: string | null;
  permissions: Permission[];
  updatedAt: string;
}

const BUILT_IN_ROLES: Role[] = [
  {
    id: "role_owner",
    orgId: null,
    name: "Owner",
    description: "Full access to all resources. Cannot be deleted or modified.",
    permissions: [...ALL_PERMISSIONS],
    isBuiltIn: true,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role_admin",
    orgId: null,
    name: "Admin",
    description:
      "Full access except ownership transfer and billing management.",
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== "billing:manage"
    ) as unknown as Permission[],
    isBuiltIn: true,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role_developer",
    orgId: null,
    name: "Developer",
    description:
      "Can create and manage projects, sessions, and tasks. Read-only for settings and billing.",
    permissions: [
      "projects:read",
      "projects:create",
      "projects:update",
      "sessions:read",
      "sessions:create",
      "sessions:cancel",
      "sessions:share",
      "tasks:read",
      "tasks:create",
      "tasks:retry",
      "deployments:read",
      "deployments:create",
      "secrets:read",
      "api_keys:read",
      "billing:read",
      "members:read",
      "settings:read",
      "integrations:read",
      "audit:read",
      "roles:read",
    ],
    isBuiltIn: true,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role_viewer",
    orgId: null,
    name: "Viewer",
    description: "Read-only access to projects, sessions, and tasks.",
    permissions: [
      "projects:read",
      "sessions:read",
      "tasks:read",
      "deployments:read",
      "members:read",
      "settings:read",
      "audit:read",
      "roles:read",
    ],
    isBuiltIn: true,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// In-memory store for custom roles (production: roles table)
// ---------------------------------------------------------------------------

const customRoleStore = new Map<string, Role>();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const permissionSchema = z.enum(
  ALL_PERMISSIONS as unknown as [string, ...string[]]
);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const rolesRouter = router({
  /**
   * List all roles available in the organization.
   *
   * Returns both built-in roles and any custom roles created by the org.
   */
  list: protectedProcedure.query(({ ctx }) => {
    logger.info({ orgId: ctx.orgId }, "Listing roles");

    const customRoles: Role[] = [];
    for (const role of customRoleStore.values()) {
      if (role.orgId === ctx.orgId) {
        customRoles.push(role);
      }
    }

    // Built-in roles first, then custom sorted by name
    customRoles.sort((a, b) => a.name.localeCompare(b.name));

    return {
      roles: [...BUILT_IN_ROLES, ...customRoles],
      builtInCount: BUILT_IN_ROLES.length,
      customCount: customRoles.length,
    };
  }),

  /**
   * Create a custom role with a specific set of permissions.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "Role name is required").max(100),
        description: z.string().max(500).optional(),
        permissions: z
          .array(permissionSchema)
          .min(1, "At least one permission is required"),
      })
    )
    .mutation(({ input, ctx }) => {
      // Check for name collision with built-in roles
      const nameExists =
        BUILT_IN_ROLES.some(
          (r) => r.name.toLowerCase() === input.name.toLowerCase()
        ) ||
        [...customRoleStore.values()].some(
          (r) =>
            r.orgId === ctx.orgId &&
            r.name.toLowerCase() === input.name.toLowerCase()
        );

      if (nameExists) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A role with the name "${input.name}" already exists`,
        });
      }

      const id = generateId("role");
      const now = new Date().toISOString();

      const role: Role = {
        id,
        orgId: ctx.orgId,
        name: input.name,
        description: input.description ?? "",
        permissions: input.permissions as Permission[],
        isBuiltIn: false,
        createdBy: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      };

      customRoleStore.set(id, role);

      logger.info(
        {
          orgId: ctx.orgId,
          roleId: id,
          name: input.name,
          permissionCount: input.permissions.length,
        },
        "Custom role created"
      );

      return role;
    }),

  /**
   * Update a custom role's name, description, or permissions.
   *
   * Built-in roles cannot be modified.
   */
  update: protectedProcedure
    .input(
      z.object({
        roleId: z.string().min(1, "Role ID is required"),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        permissions: z.array(permissionSchema).min(1).optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      // Prevent modification of built-in roles
      if (BUILT_IN_ROLES.some((r) => r.id === input.roleId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in roles cannot be modified",
        });
      }

      const role = customRoleStore.get(input.roleId);

      if (!role || role.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom role not found",
        });
      }

      // Check for name collision if name is being changed
      if (input.name && input.name.toLowerCase() !== role.name.toLowerCase()) {
        const nameExists =
          BUILT_IN_ROLES.some(
            (r) => r.name.toLowerCase() === input.name?.toLowerCase()
          ) ||
          [...customRoleStore.values()].some(
            (r) =>
              r.orgId === ctx.orgId &&
              r.id !== input.roleId &&
              r.name.toLowerCase() === input.name?.toLowerCase()
          );

        if (nameExists) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A role with the name "${input.name}" already exists`,
          });
        }
      }

      if (input.name !== undefined) {
        role.name = input.name;
      }
      if (input.description !== undefined) {
        role.description = input.description;
      }
      if (input.permissions !== undefined) {
        role.permissions = input.permissions as Permission[];
      }
      role.updatedAt = new Date().toISOString();

      customRoleStore.set(input.roleId, role);

      logger.info(
        { orgId: ctx.orgId, roleId: input.roleId },
        "Custom role updated"
      );

      return role;
    }),

  /**
   * Delete a custom role.
   *
   * Built-in roles cannot be deleted. In production, this would also
   * reassign any members with this role to the default "Viewer" role.
   */
  delete: protectedProcedure
    .input(
      z.object({
        roleId: z.string().min(1, "Role ID is required"),
      })
    )
    .mutation(({ input, ctx }) => {
      if (BUILT_IN_ROLES.some((r) => r.id === input.roleId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in roles cannot be deleted",
        });
      }

      const role = customRoleStore.get(input.roleId);

      if (!role || role.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom role not found",
        });
      }

      customRoleStore.delete(input.roleId);

      logger.info(
        { orgId: ctx.orgId, roleId: input.roleId, name: role.name },
        "Custom role deleted"
      );

      return { success: true, deletedRoleId: input.roleId };
    }),

  /**
   * List all available permissions in the platform.
   *
   * Useful for building role-creation UIs where admins can pick from
   * the full list of available permissions.
   */
  listPermissions: protectedProcedure.query(() => {
    // Group permissions by resource for UI rendering
    const grouped: Record<
      string,
      Array<{ permission: string; action: string }>
    > = {};

    for (const permission of ALL_PERMISSIONS) {
      const [resource, action] = permission.split(":");
      const key = resource ?? permission;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push({ permission, action: action ?? "read" });
    }

    return {
      permissions: ALL_PERMISSIONS.map((p) => {
        const [resource, action] = p.split(":");
        return {
          permission: p,
          resource: resource ?? p,
          action: action ?? "read",
        };
      }),
      grouped,
      totalCount: ALL_PERMISSIONS.length,
    };
  }),
});
