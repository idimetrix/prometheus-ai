import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:quantized-embeddings");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Multi-resolution embedding dimensions */
export const FAST_SEARCH_DIM = 256;
export const PRECISE_SEARCH_DIM = 768;

// ─── Quantization ─────────────────────────────────────────────────────────────

/**
 * Quantize Float32 embedding to Int8 for 4x storage reduction.
 *
 * Uses linear quantization: maps [min, max] -> [-128, 127].
 * Stores scale and offset as the first 8 bytes for dequantization.
 */
export function quantize(embedding: number[]): Int8Array {
  if (embedding.length === 0) {
    return new Int8Array(0);
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const val of embedding) {
    if (val < min) {
      min = val;
    }
    if (val > max) {
      max = val;
    }
  }

  const range = max - min;
  const scale = range === 0 ? 1 : range / 255;

  // Encode scale and offset as first 8 bytes (2 Float32 values)
  const result = new Int8Array(embedding.length + 8);
  const header = new Float32Array(2);
  header[0] = scale;
  header[1] = min;
  const headerBytes = new Int8Array(header.buffer);
  result.set(headerBytes, 0);

  // Quantize values
  for (let i = 0; i < embedding.length; i++) {
    const normalized = ((embedding[i] ?? 0) - min) / scale;
    result[i + 8] = Math.round(normalized) - 128;
  }

  return result;
}

/**
 * Dequantize Int8 embedding back to Float32.
 *
 * Reads scale and offset from the first 8 bytes.
 */
export function dequantize(quantized: Int8Array): number[] {
  if (quantized.length <= 8) {
    return [];
  }

  // Read header
  const headerBuffer = new ArrayBuffer(8);
  const headerView = new Int8Array(headerBuffer);
  for (let i = 0; i < 8; i++) {
    headerView[i] = quantized[i] ?? 0;
  }
  const header = new Float32Array(headerBuffer);
  const scale = header[0] ?? 1;
  const min = header[1] ?? 0;

  // Dequantize
  const result: number[] = [];
  for (let i = 8; i < quantized.length; i++) {
    const intVal = (quantized[i] ?? 0) + 128;
    result.push(intVal * scale + min);
  }

  return result;
}

/**
 * Reduce embedding dimensionality for fast approximate search.
 *
 * Uses simple truncation (first N dimensions), which works well with
 * embeddings trained with Matryoshka representation learning.
 *
 * @param embedding - Full-dimension embedding
 * @param targetDim - Target dimension (default: 256)
 */
export function reduceDimension(
  embedding: number[],
  targetDim: number = FAST_SEARCH_DIM
): number[] {
  if (embedding.length <= targetDim) {
    return embedding;
  }
  return embedding.slice(0, targetDim);
}

/**
 * Compute cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Multi-resolution search: first search with fast (256-dim) embeddings,
 * then re-rank top candidates with precise (768-dim) embeddings.
 *
 * @param query - Query embedding (full dimension)
 * @param candidates - Candidate embeddings (full dimension)
 * @param topK - Number of results to return
 * @param fastTopK - Number of candidates to pass to re-ranking (default: topK * 3)
 */
export function multiResolutionSearch(
  query: number[],
  candidates: { id: string; embedding: number[] }[],
  topK: number,
  fastTopK?: number
): { id: string; score: number }[] {
  const fastK = fastTopK ?? topK * 3;
  const queryFast = reduceDimension(query, FAST_SEARCH_DIM);

  // Phase 1: Fast approximate search with reduced dimensions
  const fastScores = candidates.map((c) => ({
    id: c.id,
    embedding: c.embedding,
    score: cosineSimilarity(
      queryFast,
      reduceDimension(c.embedding, FAST_SEARCH_DIM)
    ),
  }));

  fastScores.sort((a, b) => b.score - a.score);
  const shortlist = fastScores.slice(0, fastK);

  // Phase 2: Precise re-ranking with full dimensions
  const preciseQuery = reduceDimension(query, PRECISE_SEARCH_DIM);
  const preciseScores = shortlist.map((c) => ({
    id: c.id,
    score: cosineSimilarity(
      preciseQuery,
      reduceDimension(c.embedding, PRECISE_SEARCH_DIM)
    ),
  }));

  preciseScores.sort((a, b) => b.score - a.score);

  logger.debug(
    { candidateCount: candidates.length, fastK, topK },
    "Multi-resolution search completed"
  );

  return preciseScores.slice(0, topK);
}

/**
 * Binary quantization: convert float32 embedding to bit vector (32x size reduction).
 * Each float is mapped to 1 bit: positive → 1, non-positive → 0.
 */
export function binaryQuantize(embedding: number[]): Uint32Array {
  const numWords = Math.ceil(embedding.length / 32);
  const bits = new Uint32Array(numWords);

  for (let i = 0; i < embedding.length; i++) {
    if ((embedding[i] ?? 0) > 0) {
      const wordIdx = Math.floor(i / 32);
      const bitIdx = i % 32;
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional bit packing for binary quantization
      bits[wordIdx] = (bits[wordIdx] ?? 0) | (1 << bitIdx);
    }
  }

  return bits;
}

/**
 * Hamming distance between two binary quantized vectors.
 * Counts the number of differing bits using Brian Kernighan's popcount.
 */
export function hammingDistance(a: Uint32Array, b: Uint32Array): number {
  let distance = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional XOR for hamming distance
    let xor = ((a[i] ?? 0) ^ (b[i] ?? 0)) >>> 0;
    while (xor !== 0) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional bit manipulation for popcount
      xor &= xor - 1;
      distance++;
    }
  }

  return distance;
}

/**
 * Binary similarity: normalized hamming similarity (0-1).
 */
export function binarySimilarity(a: Uint32Array, b: Uint32Array): number {
  const totalBits = Math.max(a.length, b.length) * 32;
  if (totalBits === 0) {
    return 1;
  }
  return 1 - hammingDistance(a, b) / totalBits;
}

/**
 * Two-phase search: binary hamming filter (phase 1) then full cosine rerank (phase 2).
 */
export function twoPhaseSearch(
  query: number[],
  candidates: Array<{ id: string; embedding: number[] }>,
  topK = 10
): Array<{ id: string; score: number }> {
  const queryBits = binaryQuantize(query);

  // Phase 1: Fast binary filter — keep top 5x candidates by hamming similarity
  const binaryScored = candidates.map((c) => ({
    ...c,
    binaryScore: binarySimilarity(queryBits, binaryQuantize(c.embedding)),
  }));

  binaryScored.sort((a, b) => b.binaryScore - a.binaryScore);
  const shortlist = binaryScored.slice(0, topK * 5);

  // Phase 2: Precise cosine rerank on shortlist
  const reranked = shortlist.map((c) => ({
    id: c.id,
    score: cosineSimilarity(query, c.embedding),
  }));

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, topK);
}
