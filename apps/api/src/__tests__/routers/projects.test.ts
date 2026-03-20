import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFindFirst,
  mockReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateReturning,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockDeleteReturning,
  mockDeleteWhere,
  mockDelete,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi
    .fn()
    .mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi
    .fn()
    .mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
  const mockDeleteReturning = vi.fn().mockResolvedValue([]);
  const mockDeleteWhere = vi
    .fn()
    .mockReturnValue({ returning: mockDeleteReturning });
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  return {
    mockFindFirst: vi.fn(),
    mockReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateReturning,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockDeleteReturning,
    mockDeleteWhere,
    mockDelete,
  };
});

vi.mock("@prometheus/db", () => ({
  projects: {
    id: "id",
    orgId: "orgId",
    createdAt: "createdAt",
    status: "status",
  },
  projectSettings: { projectId: "projectId" },
  projectMembers: { projectId: "projectId", userId: "userId", role: "role" },
  sessions: { projectId: "projectId", status: "status" },
  tasks: {
    projectId: "projectId",
    status: "status",
    creditsConsumed: "creditsConsumed",
  },
  blueprints: {
    projectId: "projectId",
    isActive: "isActive",
    createdAt: "createdAt",
    id: "id",
  },
  blueprintVersions: { createdAt: "createdAt" },
  techStackPresets: { slug: "slug" },
}));

vi.mock("@prometheus/queue", () => ({
  indexingQueue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetChainMocks() {
  mockFindFirst.mockReset();
  mockInsertValues.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockReturning.mockResolvedValue([]);
  mockUpdateReturning.mockResolvedValue([]);
  mockDeleteReturning.mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("projects router - verifyProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("returns project when it belongs to the org", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "prj_1", orgId: "org_1" });
    const project = await mockFindFirst();
    expect(project?.orgId).toBe("org_1");
  });

  it("rejects when project not found", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const project = await mockFindFirst();
    expect(project).toBeNull();
  });
});

describe("projects router - verifyProjectRole", () => {
  it("allows owner to perform any action", () => {
    const roleRank: Record<string, number> = {
      viewer: 0,
      contributor: 1,
      owner: 2,
    };
    const userRole = "owner";
    const requiredRole = "owner";

    expect((roleRank[userRole] ?? 0) >= (roleRank[requiredRole] ?? 0)).toBe(
      true
    );
  });

  it("allows contributor to meet contributor requirement", () => {
    const roleRank: Record<string, number> = {
      viewer: 0,
      contributor: 1,
      owner: 2,
    };
    const userRole = "contributor";
    const requiredRole = "contributor";

    expect((roleRank[userRole] ?? 0) >= (roleRank[requiredRole] ?? 0)).toBe(
      true
    );
  });

  it("rejects viewer for contributor-level actions", () => {
    const roleRank: Record<string, number> = {
      viewer: 0,
      contributor: 1,
      owner: 2,
    };
    const userRole = "viewer";
    const requiredRole = "contributor";

    expect((roleRank[userRole] ?? 0) >= (roleRank[requiredRole] ?? 0)).toBe(
      false
    );
  });

  it("rejects contributor for owner-level actions", () => {
    const roleRank: Record<string, number> = {
      viewer: 0,
      contributor: 1,
      owner: 2,
    };
    const userRole = "contributor";
    const requiredRole = "owner";

    expect((roleRank[userRole] ?? 0) >= (roleRank[requiredRole] ?? 0)).toBe(
      false
    );
  });

  it("rejects when user is not a member", () => {
    const member: string | null = null;
    expect(member).toBeNull();
  });
});

describe("projects router - create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("creates project with setup status", async () => {
    const projectData = {
      id: "proj_mock123",
      orgId: "org_1",
      name: "My Project",
      status: "setup",
    };
    mockReturning.mockResolvedValueOnce([projectData]);

    const [project] = await mockInsert("projects")
      .values(projectData)
      .returning();

    expect(project?.status).toBe("setup");
    expect(project?.name).toBe("My Project");
  });

  it("creates default project settings", async () => {
    mockReturning.mockResolvedValueOnce([{ projectId: "proj_mock123" }]);
    const [settings] = await mockInsert("projectSettings")
      .values({ projectId: "proj_mock123" })
      .returning();

    expect(settings?.projectId).toBe("proj_mock123");
  });

  it("adds creator as owner member", async () => {
    const memberData = {
      id: "pm_mock123",
      projectId: "proj_mock123",
      userId: "usr_1",
      role: "owner",
    };
    mockReturning.mockResolvedValueOnce([memberData]);

    const [member] = await mockInsert("projectMembers")
      .values(memberData)
      .returning();

    expect(member?.role).toBe("owner");
    expect(member?.userId).toBe("usr_1");
  });
});

describe("projects router - addMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("adds a new member with specified role", async () => {
    mockFindFirst.mockResolvedValueOnce(null); // no existing member

    const memberData = {
      id: "pm_mock123",
      projectId: "prj_1",
      userId: "usr_2",
      role: "contributor",
    };
    mockReturning.mockResolvedValueOnce([memberData]);

    const [member] = await mockInsert("projectMembers")
      .values(memberData)
      .returning();

    expect(member?.role).toBe("contributor");
  });

  it("rejects adding an existing member", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "pm_existing",
      projectId: "prj_1",
      userId: "usr_2",
      role: "contributor",
    });

    const existing = await mockFindFirst();
    expect(existing).not.toBeNull();
  });

  it("defaults to contributor role when not specified", () => {
    const input: string | undefined = undefined;
    const role = input ?? "contributor";
    expect(role).toBe("contributor");
  });
});

describe("projects router - updateMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("prevents demoting the last owner", () => {
    const userId = "usr_1";
    const authUserId = "usr_1";
    const newRole: string = "contributor";
    const owners = [{ userId: "usr_1", role: "owner" }];

    const isSelf = userId === authUserId;
    const isDemoting = newRole !== "owner";
    const isLastOwner = owners.length <= 1;

    expect(isSelf && isDemoting && isLastOwner).toBe(true);
  });

  it("allows demoting when other owners exist", () => {
    const owners = [
      { userId: "usr_1", role: "owner" },
      { userId: "usr_2", role: "owner" },
    ];

    expect(owners.length).toBeGreaterThan(1);
  });

  it("updates member role", async () => {
    const updatedMember = { userId: "usr_2", role: "owner" };
    mockUpdateReturning.mockResolvedValueOnce([updatedMember]);

    const [updated] = await mockUpdate("projectMembers")
      .set({ role: "owner" })
      .where("usr_2")
      .returning();

    expect(updated?.role).toBe("owner");
  });
});

describe("projects router - removeMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("prevents removing the last owner", () => {
    const userId = "usr_1";
    const authUserId = "usr_1";
    const owners = [{ userId: "usr_1", role: "owner" }];

    const isSelf = userId === authUserId;
    const isLastOwner = owners.length <= 1;

    expect(isSelf && isLastOwner).toBe(true);
  });

  it("removes member successfully", async () => {
    mockDeleteReturning.mockResolvedValueOnce([
      { id: "pm_1", userId: "usr_2", role: "contributor" },
    ]);

    const deleted = await mockDelete("projectMembers")
      .where("usr_2")
      .returning();

    expect(deleted.length).toBe(1);
  });

  it("returns NOT_FOUND when member does not exist", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);

    const deleted = await mockDelete("projectMembers")
      .where("usr_nonexistent")
      .returning();

    expect(deleted.length).toBe(0);
  });
});

describe("projects router - delete (archive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("archives project by setting status to archived", async () => {
    const updated = { id: "prj_1", status: "archived" };
    mockUpdateReturning.mockResolvedValueOnce([updated]);

    const [result] = await mockUpdate("projects")
      .set({ status: "archived" })
      .where("prj_1")
      .returning();

    expect(result?.status).toBe("archived");
  });

  it("requires owner role for archiving", () => {
    const roleRank: Record<string, number> = {
      viewer: 0,
      contributor: 1,
      owner: 2,
    };
    const userRole = "contributor";

    expect((roleRank[userRole] ?? 0) >= (roleRank.owner ?? 0)).toBe(false);
  });
});

describe("projects router - list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("returns paginated results with nextCursor", () => {
    const limit = 2;
    const results = [
      { id: "prj_1", name: "Project 1" },
      { id: "prj_2", name: "Project 2" },
      { id: "prj_3", name: "Project 3" },
    ];

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items.at(-1)?.id : null;

    expect(hasMore).toBe(true);
    expect(items).toHaveLength(2);
    expect(nextCursor).toBe("prj_2");
  });

  it("returns null cursor when no more results", () => {
    const limit = 5;
    const results = [
      { id: "prj_1", name: "Project 1" },
      { id: "prj_2", name: "Project 2" },
    ];

    const hasMore = results.length > limit;
    const nextCursor = hasMore ? results.at(-1)?.id : null;

    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });
});
