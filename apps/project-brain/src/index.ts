import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import {
  initSentry,
  initTelemetry,
  metricsMiddleware,
  traceMiddleware,
} from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";
import { Hono } from "hono";

await initTelemetry({ serviceName: "project-brain" });
initSentry({ serviceName: "project-brain" });
installShutdownHandlers();

import { ConventionExtractor } from "./analyzers/convention-extractor";
import { BlueprintAutoUpdater } from "./blueprint/auto-updater";
import { BlueprintEnforcer } from "./blueprint/enforcer";
import { ContextAssembler } from "./context/assembler";
import { FileIndexer } from "./indexing/file-indexer";
import { DomainKnowledgeLayer } from "./layers/domain-knowledge";
import { EpisodicLayer } from "./layers/episodic";
import { KnowledgeGraphLayer } from "./layers/knowledge-graph";
import { ProceduralLayer } from "./layers/procedural";
import { Reranker } from "./layers/reranker";
import { SemanticLayer, verifyEmbeddingService } from "./layers/semantic";
import { SessionPersistence } from "./layers/session-persistence";
import { WorkingMemoryLayer } from "./layers/working-memory";
// Phase 9 imports
import {
  ConversationalMemoryLayer,
  type MemoryCategory,
} from "./memory/conversational";
import { SymbolStore } from "./parsers/symbols";
import { parseTypeScript } from "./parsers/tree-sitter";
import { SessionResume } from "./resume/session-resume";

const logger = createLogger("project-brain");
const app = new Hono();

app.use("/*", traceMiddleware("project-brain"));
app.use("/*", metricsMiddleware());

// Shared-secret auth middleware for internal service-to-service calls
app.use("/*", async (c, next) => {
  if (
    c.req.path === "/health" ||
    c.req.path === "/live" ||
    c.req.path === "/ready" ||
    c.req.path === "/metrics"
  ) {
    return next();
  }
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (secret) {
    const provided = c.req.header("x-internal-secret");
    if (provided !== secret) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
  return;
});

// Initialize layers
const semantic = new SemanticLayer();
const knowledgeGraph = new KnowledgeGraphLayer();
const episodic = new EpisodicLayer();
const procedural = new ProceduralLayer();
const workingMemory = new WorkingMemoryLayer();

// Phase 9: New layers and services
const conversationalMemory = new ConversationalMemoryLayer();
const symbolStore = new SymbolStore();
const conventionExtractor = new ConventionExtractor(
  symbolStore,
  conversationalMemory
);

// Initialize higher-level services
const reranker = new Reranker();
const contextAssembler = new ContextAssembler(
  semantic,
  knowledgeGraph,
  episodic,
  procedural,
  workingMemory,
  reranker
);
const sessionResume = new SessionResume(
  contextAssembler,
  workingMemory,
  episodic
);
const fileIndexer = new FileIndexer(semantic, knowledgeGraph);
const blueprintEnforcer = new BlueprintEnforcer();

// ---- Health ----

app.get("/health", async (c) => {
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }
  const checks: Record<string, boolean> = {};

  // Check Redis connectivity (used by working memory layer)
  try {
    const { redis } = await import("@prometheus/queue");
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }

  // Check database connectivity
  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  const allHealthy = Object.values(checks).every(Boolean);
  const status = allHealthy ? "ok" : "degraded";

  return c.json(
    {
      status,
      checks,
      uptime: Math.floor(process.uptime()),
      version: "0.1.0",
      service: "project-brain",
      timestamp: new Date().toISOString(),
    },
    allHealthy ? 200 : 503
  );
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — can accept traffic
app.get("/ready", (c) => c.json({ status: "ready" }));

// ---- Context Assembly ----

app.post("/context/assemble", async (c) => {
  const body = await c.req.json();
  const context = await contextAssembler.assemble({
    projectId: body.projectId,
    sessionId: body.sessionId,
    taskDescription: body.taskDescription,
    agentRole: body.agentRole,
    maxTokens: body.maxTokens ?? 14_000,
  });
  return c.json(context);
});

// ---- Session Resume ----

app.post("/sessions/:sessionId/resume", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const briefing = await sessionResume.generateBriefing(
    sessionId,
    body.projectId
  );
  return c.json(briefing);
});

// ---- File Indexing ----

app.post("/index/file", async (c) => {
  const body = await c.req.json();
  const indexed = await fileIndexer.indexFile(
    body.projectId,
    body.filePath,
    body.content
  );
  return c.json({ success: true, indexed });
});

app.post("/index/directory", async (c) => {
  const body = await c.req.json();
  const stats = await fileIndexer.indexDirectory(body.projectId, body.dirPath);
  return c.json({ success: true, ...stats });
});

app.post("/index/changes", async (c) => {
  const body = await c.req.json();
  const stats = await fileIndexer.indexChanges(body.projectId, body.changes);
  return c.json({ success: true, ...stats });
});

app.get("/index/progress/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const progress = fileIndexer.getProgress(projectId);
  if (!progress) {
    return c.json({ active: false });
  }
  return c.json({ active: true, ...progress });
});

// ---- Semantic Search ----

app.post("/search/semantic", async (c) => {
  const body = await c.req.json();
  const results = await semantic.search(
    body.projectId,
    body.query,
    body.limit ?? 10
  );
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

  return c.json(
    {
      success: false,
      error: "Unknown memory type. Use 'episodic' or 'procedural'.",
    },
    400
  );
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
  if (!filePath) {
    return c.json({ error: "filePath query parameter required" }, 400);
  }

  const deps = await knowledgeGraph.getDependencies(projectId, filePath);
  return c.json({ dependencies: deps });
});

app.get("/graph/dependents/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("filePath");
  if (!filePath) {
    return c.json({ error: "filePath query parameter required" }, 400);
  }

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

  return c.json(
    { error: "Provide { key, value } or a record of key-value pairs" },
    400
  );
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
    body.changes ?? []
  );
  return c.json({
    violations,
    passed: violations.filter((v) => v.severity === "error").length === 0,
    errorCount: violations.filter((v) => v.severity === "error").length,
    warningCount: violations.filter((v) => v.severity === "warning").length,
  });
});

// ---- Phase 9.1: Enhanced Knowledge Graph ----

app.post("/graph/traverse", async (c) => {
  const body = await c.req.json();
  const { projectId, startNodeId, maxHops, edgeTypes } = body;
  if (!(projectId && startNodeId)) {
    return c.json({ error: "projectId and startNodeId required" }, 400);
  }
  const result = await knowledgeGraph.traverseFromNode(
    projectId,
    startNodeId,
    maxHops ?? 2,
    edgeTypes
  );
  return c.json(result);
});

app.post("/graph/related-context", async (c) => {
  const body = await c.req.json();
  const result = await knowledgeGraph.getRelatedContext(
    body.projectId,
    body.filePath,
    body.maxHops ?? 2
  );
  return c.json(result);
});

app.get("/graph/file-deps/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await knowledgeGraph.getFileDependencyGraph(projectId);
  return c.json(result);
});

app.get("/graph/call-graph/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await knowledgeGraph.getFunctionCallGraph(projectId);
  return c.json(result);
});

app.get("/graph/stats/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const stats = await knowledgeGraph.getStats(projectId);
  return c.json(stats);
});

// ---- Phase 9.2: Conversational Memory ----

app.post("/conversational-memory/store", async (c) => {
  const body = await c.req.json();
  const memory = await conversationalMemory.store(body.projectId, {
    content: body.content,
    category: body.category ?? "general",
    importance: body.importance,
    tags: body.tags,
  });
  return c.json({ success: true, memory });
});

app.post("/conversational-memory/retrieve", async (c) => {
  const body = await c.req.json();
  const memories = await conversationalMemory.retrieve(
    body.projectId,
    body.query,
    body.limit ?? 10,
    body.categories
  );
  return c.json({ memories });
});

app.get("/conversational-memory/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const category = c.req.query("category") as MemoryCategory | undefined;
  const limit = Number(c.req.query("limit") ?? 50);
  const memories = await conversationalMemory.getAll(
    projectId,
    category,
    limit
  );
  return c.json({ memories });
});

app.post("/conversational-memory/extract", async (c) => {
  const body = await c.req.json();
  const extracted = await conversationalMemory.extractFromConversation(
    body.projectId,
    body.messages
  );
  return c.json({
    success: true,
    extracted: extracted.length,
    memories: extracted,
  });
});

app.post("/conversational-memory/prune", async (c) => {
  const body = await c.req.json();
  const pruned = await conversationalMemory.prune(
    body.projectId,
    body.minImportance ?? 0.05
  );
  return c.json({ success: true, pruned });
});

// ---- Phase 9.3: Code Parsing / Symbol Tables ----

app.post("/parse/file", async (c) => {
  const body = await c.req.json();
  const { projectId, filePath, content } = body;
  if (!(filePath && content)) {
    return c.json({ error: "filePath and content required" }, 400);
  }

  const symbols = parseTypeScript(filePath, content);

  if (projectId) {
    await symbolStore.store(projectId, symbols);
  }

  return c.json({ success: true, symbols });
});

app.post("/symbols/search", async (c) => {
  const body = await c.req.json();
  const results = await symbolStore.searchSymbol(body.projectId, body.query);
  return c.json({ results });
});

app.get("/symbols/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("filePath");
  if (filePath) {
    const table = await symbolStore.get(projectId, filePath);
    return c.json({ symbolTable: table });
  }
  const stats = await symbolStore.getStats(projectId);
  return c.json(stats);
});

app.get("/symbols/exports/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const exports = await symbolStore.getExportedSymbols(projectId);
  return c.json({ exports });
});

// ---- Phase 9.6: Convention Extraction ----

app.post("/conventions/extract", async (c) => {
  const body = await c.req.json();
  const result = await conventionExtractor.extractFromFiles(
    body.projectId,
    body.files
  );
  return c.json(result);
});

app.get("/conventions/prompt/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const prompt = await conventionExtractor.getConventionPrompt(projectId);
  return c.json({ prompt });
});

// ---- Phase 9.7: Cross-Session Learning ----

app.post("/procedural/learn", async (c) => {
  const body = await c.req.json();
  const procedure = await procedural.learnFromSuccess(body.projectId, {
    taskDescription: body.taskDescription,
    stepsPerformed: body.stepsPerformed,
    toolsUsed: body.toolsUsed ?? [],
    filesChanged: body.filesChanged ?? [],
    agentRole: body.agentRole,
  });
  return c.json({ success: true, procedure });
});

app.post("/procedural/find-relevant", async (c) => {
  const body = await c.req.json();
  const procedures = await procedural.findRelevantProcedures(
    body.projectId,
    body.taskDescription,
    body.limit ?? 5
  );
  return c.json({ procedures });
});

app.get("/procedural/top/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const limit = Number(c.req.query("limit") ?? 10);
  const procedures = await procedural.getTopProcedures(projectId, limit);
  return c.json({ procedures });
});

app.post("/procedural/record-success", async (c) => {
  const body = await c.req.json();
  await procedural.recordSuccess(body.projectId, body.name);
  return c.json({ success: true });
});

app.post("/procedural/record-failure", async (c) => {
  const body = await c.req.json();
  await procedural.recordFailure(body.projectId, body.name);
  return c.json({ success: true });
});

app.post("/procedural/prune", async (c) => {
  const body = await c.req.json();
  const pruned = await procedural.pruneIneffective(body.projectId);
  return c.json({ success: true, pruned });
});

// ---- Blueprint Auto-Update ----

app.post("/blueprint/propose-update", async (c) => {
  const body = await c.req.json();
  const updater = new BlueprintAutoUpdater();
  const result = await updater.proposeUpdate(body.projectId, body.sessionId, {
    section: body.section,
    change: body.change,
    reasoning: body.reasoning,
    sourceAgent: body.sourceAgent,
    riskLevel: body.riskLevel ?? "low",
  });
  return c.json(result);
});

app.get("/blueprint/versions/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const updater = new BlueprintAutoUpdater();
  const versions = await updater.getVersionHistory(projectId);
  return c.json({ versions });
});

// ---- Session Persistence ----

const sessionPersistence = new SessionPersistence(workingMemory, episodic);

app.post("/sessions/:sessionId/persist", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const result = await sessionPersistence.onSessionEnd(
    sessionId,
    body.projectId,
    body.summary
  );
  return c.json(result);
});

app.post("/sessions/:sessionId/load-prior", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const result = await sessionPersistence.onSessionStart(
    sessionId,
    body.projectId
  );
  return c.json(result);
});

// ---- Domain Knowledge ----

const domainKnowledge = new DomainKnowledgeLayer();

app.post("/domain-knowledge/seed", async (c) => {
  const body = await c.req.json();
  const count = domainKnowledge.seedFromTechStack(
    body.projectId,
    body.techStack
  );
  return c.json({ success: true, seeded: count });
});

app.post("/domain-knowledge/contribute", async (c) => {
  const body = await c.req.json();
  const entry = domainKnowledge.contribute(body.projectId, {
    category: body.category,
    topic: body.topic,
    content: body.content,
    framework: body.framework,
    tags: body.tags ?? [],
    contributedBy: body.contributedBy,
  });
  return c.json({ success: true, entry });
});

app.post("/domain-knowledge/query", async (c) => {
  const body = await c.req.json();
  const results = domainKnowledge.query(
    body.projectId,
    body.query,
    body.limit ?? 5
  );
  return c.json({ results });
});

// ---- Prometheus Metrics ----

app.get("/metrics", async (c) => {
  const { metricsRegistry } = await import("@prometheus/telemetry");
  return c.text(await metricsRegistry.render(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// ---- Error handling ----

app.onError((err, c) => {
  logger.error(
    { err, path: c.req.path, method: c.req.method },
    "Unhandled error"
  );
  return c.json({ error: "Internal server error" }, 500);
});

// ---- Start server ----

const port = Number(process.env.PROJECT_BRAIN_PORT ?? 4003);

serve({ fetch: app.fetch, port }, async () => {
  logger.info(`Project Brain running on port ${port}`);

  // Verify embedding service availability at startup
  const embeddingAvailable = await verifyEmbeddingService();
  if (!embeddingAvailable) {
    logger.warn(
      "Embedding service unavailable at startup — semantic search will be degraded. " +
        "Pull the model with: ollama pull nomic-embed-text"
    );
  }
});
