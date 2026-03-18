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

const logger = createLogger("project-brain");
const app = new Hono();

// Initialize layers
const semantic = new SemanticLayer();
const knowledgeGraph = new KnowledgeGraphLayer();
const episodic = new EpisodicLayer();
const procedural = new ProceduralLayer();
const workingMemory = new WorkingMemoryLayer();

const contextAssembler = new ContextAssembler(
  semantic, knowledgeGraph, episodic, procedural, workingMemory
);
const sessionResume = new SessionResume(contextAssembler);

app.get("/health", (c) => c.json({ status: "ok" }));

// Assemble context for an agent
app.post("/context/assemble", async (c) => {
  const body = await c.req.json();
  const context = await contextAssembler.assemble({
    projectId: body.projectId,
    taskDescription: body.taskDescription,
    agentRole: body.agentRole,
    maxTokens: body.maxTokens ?? 14000,
  });
  return c.json(context);
});

// Resume a session
app.post("/sessions/:sessionId/resume", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const briefing = await sessionResume.generateBriefing(sessionId, body.projectId);
  return c.json(briefing);
});

// Index a file
app.post("/index/file", async (c) => {
  const body = await c.req.json();
  await semantic.indexFile(body.projectId, body.filePath, body.content);
  return c.json({ success: true });
});

// Semantic search
app.post("/search/semantic", async (c) => {
  const body = await c.req.json();
  const results = await semantic.search(body.projectId, body.query, body.limit ?? 10);
  return c.json({ results });
});

// Store a memory
app.post("/memory/store", async (c) => {
  const body = await c.req.json();
  if (body.type === "episodic") {
    await episodic.store(body.projectId, body.data);
  } else if (body.type === "procedural") {
    await procedural.store(body.projectId, body.data);
  }
  return c.json({ success: true });
});

// Query knowledge graph
app.post("/graph/query", async (c) => {
  const body = await c.req.json();
  const result = await knowledgeGraph.query(body.projectId, body.query);
  return c.json(result);
});

// Working memory operations
app.post("/working-memory/set", async (c) => {
  const body = await c.req.json();
  await workingMemory.set(body.sessionId, body.key, body.value, body.ttlSeconds);
  return c.json({ success: true });
});

app.get("/working-memory/:sessionId/:key", async (c) => {
  const sessionId = c.req.param("sessionId");
  const key = c.req.param("key");
  const value = await workingMemory.get(sessionId, key);
  return c.json({ value });
});

const port = Number(process.env.PROJECT_BRAIN_PORT ?? 4005);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Project Brain running on port ${port}`);
});
