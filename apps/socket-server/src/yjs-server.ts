import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { type WebSocket, WebSocketServer } from "ws";

const logger = createLogger("socket-server:yjs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for persisted Yjs documents */
const DOC_KEY_PREFIX = "yjs:doc:";

/** Redis key prefix for awareness state */
const AWARENESS_KEY_PREFIX = "yjs:awareness:";

/** TTL for awareness entries (seconds) — stale entries expire automatically */
const AWARENESS_TTL_SECONDS = 120;

/** Flush interval for persisting docs to Redis (ms) */
const FLUSH_INTERVAL_MS = 5000;

/** Max document size in bytes (10 MB) */
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Yjs sync protocol message types
// These match the yjs-protocols spec:
// - 0: sync step 1 (request)
// - 1: sync step 2 (response with state)
// - 2: update (incremental)
// - 3: awareness update
// - 4: awareness query
// ---------------------------------------------------------------------------

const MSG_SYNC_STEP1 = 0;
const MSG_SYNC_STEP2 = 1;
const MSG_SYNC_UPDATE = 2;
const MSG_AWARENESS_UPDATE = 3;
const MSG_AWARENESS_QUERY = 4;

// ---------------------------------------------------------------------------
// In-memory document store (flushed to Redis periodically)
// ---------------------------------------------------------------------------

interface YjsDocument {
  /** Awareness states by client ID */
  awareness: Map<number, Uint8Array>;
  /** Connected clients */
  clients: Set<WebSocket>;
  /** Whether the doc has unflushed changes */
  dirty: boolean;
  /** Binary document state (accumulated updates merged) */
  updates: Uint8Array[];
}

const documents = new Map<string, YjsDocument>();

// ---------------------------------------------------------------------------
// Redis persistence helpers
// ---------------------------------------------------------------------------

let redisClient: ReturnType<typeof createRedisConnection> | null = null;

function getRedis(): ReturnType<typeof createRedisConnection> {
  if (!redisClient) {
    try {
      redisClient = createRedisConnection();
    } catch {
      logger.warn(
        "Redis not available for Yjs persistence, using in-memory only"
      );
    }
  }
  return redisClient as ReturnType<typeof createRedisConnection>;
}

async function loadDocFromRedis(docId: string): Promise<Uint8Array | null> {
  try {
    const redis = getRedis();
    if (!redis) {
      return null;
    }
    const data = await redis.getBuffer(`${DOC_KEY_PREFIX}${docId}`);
    return data ? new Uint8Array(data) : null;
  } catch (error) {
    logger.error({ docId, error }, "Failed to load Yjs doc from Redis");
    return null;
  }
}

async function saveDocToRedis(docId: string, state: Uint8Array): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    await redis.set(`${DOC_KEY_PREFIX}${docId}`, Buffer.from(state));
    logger.debug({ docId, size: state.length }, "Yjs doc flushed to Redis");
  } catch (error) {
    logger.error({ docId, error }, "Failed to save Yjs doc to Redis");
  }
}

async function saveAwarenessToRedis(
  docId: string,
  clientId: number,
  state: Uint8Array
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    const key = `${AWARENESS_KEY_PREFIX}${docId}:${clientId}`;
    await redis.set(key, Buffer.from(state), "EX", AWARENESS_TTL_SECONDS);
  } catch {
    // Non-critical — awareness is ephemeral
  }
}

async function removeAwarenessFromRedis(
  docId: string,
  clientId: number
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      return;
    }
    await redis.del(`${AWARENESS_KEY_PREFIX}${docId}:${clientId}`);
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

function getOrCreateDoc(docId: string): YjsDocument {
  let doc = documents.get(docId);
  if (!doc) {
    doc = {
      updates: [],
      clients: new Set(),
      awareness: new Map(),
      dirty: false,
    };
    documents.set(docId, doc);
  }
  return doc;
}

/** Merge all accumulated updates into a single update array */
function getMergedState(doc: YjsDocument): Uint8Array {
  if (doc.updates.length === 0) {
    return new Uint8Array(0);
  }
  if (doc.updates.length === 1) {
    return doc.updates[0] as Uint8Array;
  }
  // Concatenate all updates
  const totalLength = doc.updates.reduce((sum, u) => sum + u.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const update of doc.updates) {
    merged.set(update, offset);
    offset += update.length;
  }
  return merged;
}

/** Get the total size of a document's updates */
function getDocSize(doc: YjsDocument): number {
  return doc.updates.reduce((sum, u) => sum + u.length, 0);
}

// ---------------------------------------------------------------------------
// Message encoding/decoding helpers
// ---------------------------------------------------------------------------

function encodeMessage(type: number, payload: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + payload.length);
  msg[0] = type;
  msg.set(payload, 1);
  return msg;
}

const DOC_ID_URL_RE = /^\/yjs\/([a-zA-Z0-9_-]+)$/;

function parseDocIdFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  // Expected format: /yjs/<docId>
  const match = url.match(DOC_ID_URL_RE);
  return match ? (match[1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Client ID assignment (simple incrementing counter per server instance)
// ---------------------------------------------------------------------------

let nextClientId = 1;

function assignClientId(): number {
  return nextClientId++;
}

// ---------------------------------------------------------------------------
// WebSocket message handler
// ---------------------------------------------------------------------------

function handleMessage(
  ws: WebSocket,
  docId: string,
  doc: YjsDocument,
  clientId: number,
  data: Buffer
): void {
  if (data.length < 1) {
    return;
  }

  const msgType = data[0] as number;
  const payload = new Uint8Array(
    data.buffer,
    data.byteOffset + 1,
    data.length - 1
  );

  switch (msgType) {
    case MSG_SYNC_STEP1: {
      // Client requests sync — respond with full state
      const state = getMergedState(doc);
      const response = encodeMessage(MSG_SYNC_STEP2, state);
      if (ws.readyState === ws.OPEN) {
        ws.send(response);
      }

      // Also send current awareness states
      for (const [aClientId, aState] of doc.awareness) {
        const idBytes = new Uint8Array(4);
        new DataView(idBytes.buffer).setUint32(0, aClientId, true);
        const combined = new Uint8Array(4 + aState.length);
        combined.set(idBytes, 0);
        combined.set(aState, 4);
        const awarenessMsg = encodeMessage(MSG_AWARENESS_UPDATE, combined);
        if (ws.readyState === ws.OPEN) {
          ws.send(awarenessMsg);
        }
      }
      break;
    }

    case MSG_SYNC_STEP2:
    case MSG_SYNC_UPDATE: {
      // Check document size limit
      if (getDocSize(doc) + payload.length > MAX_DOC_SIZE_BYTES) {
        logger.warn(
          { docId, size: getDocSize(doc) + payload.length },
          "Document size limit exceeded, rejecting update"
        );
        return;
      }

      // Store update
      doc.updates.push(new Uint8Array(payload));
      doc.dirty = true;

      // Broadcast to all other clients in the document
      const broadcastMsg = encodeMessage(MSG_SYNC_UPDATE, payload);
      for (const client of doc.clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(broadcastMsg);
        }
      }
      break;
    }

    case MSG_AWARENESS_UPDATE: {
      // Store and broadcast awareness
      doc.awareness.set(clientId, new Uint8Array(payload));

      // Persist awareness to Redis
      saveAwarenessToRedis(docId, clientId, payload).catch(() => {
        // Non-critical — fire and forget
      });

      // Add client ID to the awareness broadcast
      const idBytes = new Uint8Array(4);
      new DataView(idBytes.buffer).setUint32(0, clientId, true);
      const combined = new Uint8Array(4 + payload.length);
      combined.set(idBytes, 0);
      combined.set(payload, 4);
      const awarenessMsg = encodeMessage(MSG_AWARENESS_UPDATE, combined);

      for (const client of doc.clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(awarenessMsg);
        }
      }
      break;
    }

    case MSG_AWARENESS_QUERY: {
      // Client requests all awareness states
      for (const [aClientId, aState] of doc.awareness) {
        const idBuf = new Uint8Array(4);
        new DataView(idBuf.buffer).setUint32(0, aClientId, true);
        const comb = new Uint8Array(4 + aState.length);
        comb.set(idBuf, 0);
        comb.set(aState, 4);
        const msg = encodeMessage(MSG_AWARENESS_UPDATE, comb);
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
      break;
    }

    default:
      logger.debug({ docId, msgType }, "Unknown Yjs message type");
  }
}

// ---------------------------------------------------------------------------
// Client disconnect handler
// ---------------------------------------------------------------------------

function handleDisconnect(
  docId: string,
  doc: YjsDocument,
  ws: WebSocket,
  clientId: number
): void {
  doc.clients.delete(ws);
  doc.awareness.delete(clientId);
  removeAwarenessFromRedis(docId, clientId).catch(() => {
    // Non-critical — fire and forget
  });

  // Broadcast awareness removal to remaining clients
  const emptyAwareness = new Uint8Array(0);
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, clientId, true);
  const combined = new Uint8Array(4 + emptyAwareness.length);
  combined.set(idBytes, 0);
  const removeMsg = encodeMessage(MSG_AWARENESS_UPDATE, combined);

  for (const client of doc.clients) {
    if (client.readyState === client.OPEN) {
      client.send(removeMsg);
    }
  }

  // Clean up empty documents
  if (doc.clients.size === 0) {
    // Flush to Redis before removing from memory
    if (doc.dirty) {
      const state = getMergedState(doc);
      saveDocToRedis(docId, state).catch(() => {
        // Non-critical — fire and forget
      });
    }
    // Keep in memory for a short period in case of reconnect
    setTimeout(() => {
      const current = documents.get(docId);
      if (current && current.clients.size === 0) {
        documents.delete(docId);
        logger.debug({ docId }, "Yjs doc removed from memory (no clients)");
      }
    }, 30_000);
  }

  logger.debug(
    { docId, clientId, remaining: doc.clients.size },
    "Yjs client disconnected"
  );
}

// ---------------------------------------------------------------------------
// Periodic flush
// ---------------------------------------------------------------------------

function startFlushInterval(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    for (const [docId, doc] of documents) {
      if (doc.dirty) {
        const state = getMergedState(doc);
        saveDocToRedis(docId, state).catch(() => {
          // Non-critical — fire and forget
        });
        doc.dirty = false;
      }
    }
  }, FLUSH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API: mount Yjs WebSocket server on /yjs path
// ---------------------------------------------------------------------------

export function mountYjsServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests on /yjs/* path
  httpServer.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = request.url;
      if (!url?.startsWith("/yjs/")) {
        // Not for us — let other handlers (Socket.io) handle it
        return;
      }

      const docId = parseDocIdFromUrl(url);
      if (!docId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, request, docId);
      });
    }
  );

  wss.on(
    "connection",
    async (ws: WebSocket, _request: IncomingMessage, docId: string) => {
      const clientId = assignClientId();
      const doc = getOrCreateDoc(docId);

      // If this is the first client and we have Redis state, load it
      if (doc.clients.size === 0 && doc.updates.length === 0) {
        const persisted = await loadDocFromRedis(docId);
        if (persisted && persisted.length > 0) {
          doc.updates.push(persisted);
          logger.debug(
            { docId, size: persisted.length },
            "Loaded Yjs doc from Redis"
          );
        }
      }

      doc.clients.add(ws);

      logger.info(
        { docId, clientId, clients: doc.clients.size },
        "Yjs client connected"
      );

      // Send sync step 2 (full state) immediately so the client can catch up
      const state = getMergedState(doc);
      if (state.length > 0) {
        const syncMsg = encodeMessage(MSG_SYNC_STEP2, state);
        ws.send(syncMsg);
      }

      ws.on("message", (rawData: Buffer) => {
        try {
          const data = Buffer.isBuffer(rawData)
            ? rawData
            : Buffer.from(rawData as unknown as ArrayBuffer);
          handleMessage(ws, docId, doc, clientId, data);
        } catch (error) {
          logger.error(
            { docId, clientId, error },
            "Error handling Yjs message"
          );
        }
      });

      ws.on("close", () => {
        handleDisconnect(docId, doc, ws, clientId);
      });

      ws.on("error", (error: Error) => {
        logger.error({ docId, clientId, error }, "Yjs WebSocket error");
        handleDisconnect(docId, doc, ws, clientId);
      });
    }
  );

  // Start periodic flush to Redis
  const flushTimer = startFlushInterval();

  // Cleanup on server close
  httpServer.on("close", () => {
    clearInterval(flushTimer);
    // Final flush
    for (const [docId, doc] of documents) {
      if (doc.dirty) {
        const state = getMergedState(doc);
        saveDocToRedis(docId, state).catch(() => {
          // Non-critical — fire and forget
        });
      }
    }
    wss.close();
  });

  logger.info("Yjs WebSocket server mounted on /yjs/:docId");
}
