import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";
import { SemanticLayer } from "./layers/semantic";
import { KnowledgeGraphLayer } from "./layers/knowledge-graph";
import { EpisodicLayer } from "./layers/episodic";
import { ProceduralLayer } from "./layers/procedural";
import { WorkingMemoryLayer } from "./layers/working-memory";
import { ContextAssembler } from "./context/assembler";
import { SessionResume } from "./resume/session-resume";
import { FileIndexer } from "./indexing/file-indexer";
import { BlueprintEnforcer } from "./blueprint/enforcer";

const logger = createLogger("project-brain");
const app = new Hono();

// Initialize layers
const semantic = new SemanticLayer();
const knowledgeGraph = new KnowledgeGraphLayer();
const episodic = new EpisodicLayer();
const procedural = new ProceduralLayer();
const workingMemory = new WorkingMemoryLayer();

// Initialize higher-level services
const contextAssembler = new ContextAssembler(
  semantic,
  knowledgeGraph,
  episodic,
  procedural,
  workingMemory,
);
const sessionResume = new SessionResume(contextAssembler, workingMemory, episodic);
const fileIndexer = new FileIndexer(semantic, knowledgeGraph);
const blueprintEnforcer = new BlueprintEnforcer();

// ---- Health ----

app.get("/health", (c) =>
  c.json({ status: "ok", service: "project-brain", timestamp: new Date().toISOString() }),
);

// ---- Context Assembly ----

app.post("/context/assemble", async (c) => {
  const body = await c.req.json();
  const context = await contextAssembler.assemble({
    projectId: body.projectId,
    sessionId: body.sessionId,
    taskDescription: body.taskDescription,
    agentRole: body.agentRole,
    maxTokens: body.maxTokens ?? 14000,
  });
  return c.json(context);
});

// ---- Session Resume ----

app.post("/sessions/:sessionId/resume", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const briefing = await sessionResume.generateBriefing(sessionId, body.projectId);
  return c.json(briefing);
});

// ---- File Indexing ----

app.post("/index/file", async (c) => {
  const body = await c.req.json();
  const indexed = await fileIndexer.indexFile(body.projectId, body.filePath, body.content);
  return c.json({ success: true, indexed });
});

app.post("/index/directory", async (c) => {
  const body = await c.req.json();
  const stats = await fileIndexer.indexDirectory(body.projectId, body.dirPath);
  return c.json({ success: true, ...stats });
});

// ---- Semantic Search ----

app.post("/search/semantic", async (c) => {
  const body = await c.req.json();
  const results = await semantic.search(body.projectId, body.query, body.limit ?? 10);
  return c.json({ results });
});

// ---- Memory Store / Retrieve ----

app.post("/memory/store", async (c) => {
  const body = await c.req.json();

  if (body.type === "episodic") {
    const memory = await episodic.store(body.projectId, body.data);
    return c.json({ success: true, id: memory.id });
  }

  if (body.type === "procedural") {
    const proc = await procedural.store(body.projectId, body.data);
    return c.json({ success: true, id: proc.id });
  }

  return c.json({ success: false, error: "Unknown memory type. Use 'episodic' or 'procedural'." }, 400);
});

app.get("/memory/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const type = c.req.query("type");
  const query = c.req.query("query");
  const limit = Number(c.req.query("limit") ?? 10);

  if (type === "episodic") {
    const memories = query
      ? await episodic.recall(projectId, query, limit)
      : await episodic.getRecent(projectId, limit);
    return c.json({ memories });
  }

  if (type === "procedural") {
    const name = c.req.query("name");
    if (name) {
      const proc = await procedural.get(projectId, name);
      return c.json({ procedure: proc });
    }
    const procedures = await procedural.list(projectId);
    return c.json({ procedures });
  }

  // Return both by default
  const [episodicMemories, procedures] = await Promise.all([
    episodic.getRecent(projectId, limit),
    procedural.list(projectId),
  ]);

  return c.json({ episodic: episodicMemories, procedural: procedures });
});

// ---- Knowledge Graph ----

app.post("/graph/query", async (c) => {
  const body = await c.req.json();
  const result = await knowledgeGraph.query(body.projectId, body.query);
  return c.json(result);
});

app.post("/graph/node", async (c) => {
  const body = await c.req.json();
  await knowledgeGraph.addNode(body.projectId, body.node);
  return c.json({ success: true });
});

app.post("/graph/edge", async (c) => {
  const body = await c.req.json();
  await knowledgeGraph.addEdge(body.projectId, body.edge);
  return c.json({ success: true });
});

app.get("/graph/dependencies/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("filePath");
  if (!filePath) return c.json({ error: "filePath query parameter required" }, 400);

  const deps = await knowledgeGraph.getDependencies(projectId, filePath);
  return c.json({ dependencies: deps });
});

app.get("/graph/dependents/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("filePath");
  if (!filePath) return c.json({ error: "filePath query parameter required" }, 400);

  const deps = await knowledgeGraph.getDependents(projectId, filePath);
  return c.json({ dependents: deps });
});

// ---- Working Memory ----

app.get("/working-memory/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const key = c.req.query("key");

  if (key) {
    const value = await workingMemory.get(sessionId, key);
    return c.json({ value });
  }

  const all = await workingMemory.getAll(sessionId);
  return c.json(all);
});

app.put("/working-memory/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  if (body.key && body.value !== undefined) {
    await workingMemory.set(sessionId, body.key, body.value, body.ttlSeconds);
    return c.json({ success: true });
  }

  // Bulk set: body is Record<string, unknown>
  if (typeof body === "object" && !body.key) {
    const entries = Object.entries(body).filter(([k]) => k !== "ttlSeconds");
    for (const [key, value] of entries) {
      await workingMemory.set(sessionId, key, value, body.ttlSeconds);
    }
    return c.json({ success: true, keysSet: entries.length });
  }

  return c.json({ error: "Provide { key, value } or a record of key-value pairs" }, 400);
});

app.delete("/working-memory/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  await workingMemory.clearSession(sessionId);
  return c.json({ success: true });
});

// ---- Blueprint Enforcement ----

app.post("/blueprint/enforce", async (c) => {
  const body = await c.req.json();
  const violations = await blueprintEnforcer.enforceBlueprint(
    body.projectId,
    body.changes ?? [],
  );
  return c.json({
    violations,
    passed: violations.filter((v) => v.severity === "error").length === 0,
    errorCount: violations.filter((v) => v.severity === "error").length,
    warningCount: violations.filter((v) => v.severity === "warning").length,
  });
});

// ---- Error handling ----

app.onError((err, c) => {
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");
  return c.json({ error: "Internal server error", message: err.message }, 500);
});

// ---- Start server ----

const port = Number(process.env.PROJECT_BRAIN_PORT ?? 4005);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Project Brain running on port ${port}`);
});
