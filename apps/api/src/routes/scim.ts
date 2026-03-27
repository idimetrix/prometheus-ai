import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";

const logger = createLogger("api:scim");

export const scimApp = new Hono();

/**
 * SCIM 2.0 Service Provider Configuration
 * GET /scim/v2/ServiceProviderConfig
 */
scimApp.get("/ServiceProviderConfig", (c) => {
  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://docs.prometheus.dev/scim",
    patch: { supported: false },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "Authentication using a Bearer token in the Authorization header",
      },
    ],
  });
});

/**
 * SCIM 2.0 Resource Types
 * GET /scim/v2/ResourceTypes
 */
scimApp.get("/ResourceTypes", (c) => {
  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: "urn:ietf:params:scim:schemas:core:2.0:User",
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
      },
    ],
  });
});

/**
 * SCIM 2.0 List Users
 * GET /scim/v2/Users
 */
scimApp.get("/Users", (c) => {
  logger.info("SCIM list users requested");

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 0,
    itemsPerPage: 20,
    startIndex: 1,
    Resources: [],
  });
});

/**
 * SCIM 2.0 Get User
 * GET /scim/v2/Users/:id
 */
scimApp.get("/Users/:id", (c) => {
  const userId = c.req.param("id");
  logger.info({ userId }, "SCIM get user requested");

  return c.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User not found",
      status: "404",
    },
    404
  );
});

/**
 * SCIM 2.0 Create User
 * POST /scim/v2/Users
 */
scimApp.post("/Users", async (c) => {
  const body = await c.req.json();
  logger.info({ userName: body.userName }, "SCIM create user requested");

  return c.json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: body.userName ?? "scim-placeholder",
      userName: body.userName,
      active: true,
      meta: {
        resourceType: "User",
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
    },
    201
  );
});

/**
 * SCIM 2.0 Update User
 * PUT /scim/v2/Users/:id
 */
scimApp.put("/Users/:id", async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json();
  logger.info({ userId }, "SCIM update user requested");

  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: userId,
    userName: body.userName,
    active: body.active ?? true,
    meta: {
      resourceType: "User",
      lastModified: new Date().toISOString(),
    },
  });
});

/**
 * SCIM 2.0 Delete User
 * DELETE /scim/v2/Users/:id
 */
scimApp.delete("/Users/:id", (c) => {
  const userId = c.req.param("id");
  logger.info({ userId }, "SCIM delete user requested");

  return c.body(null, 204);
});

/**
 * SCIM 2.0 List Groups
 * GET /scim/v2/Groups
 */
scimApp.get("/Groups", (c) => {
  logger.info("SCIM list groups requested");

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 0,
    itemsPerPage: 20,
    startIndex: 1,
    Resources: [],
  });
});

/**
 * SCIM 2.0 Create Group
 * POST /scim/v2/Groups
 */
scimApp.post("/Groups", async (c) => {
  const body = await c.req.json();
  logger.info({ displayName: body.displayName }, "SCIM create group requested");

  return c.json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: body.displayName ?? "scim-group-placeholder",
      displayName: body.displayName,
      members: body.members ?? [],
      meta: {
        resourceType: "Group",
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
    },
    201
  );
});
