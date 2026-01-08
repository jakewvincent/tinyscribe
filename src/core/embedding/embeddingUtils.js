/**
 * Embedding Utilities
 * Shared functions for embedding normalization and manipulation
 */

/**
 * L2 normalize an embedding vector in-place
 * Converts the vector to unit length (magnitude 1)
 * @param {Float32Array|Array} embedding - The embedding to normalize
 * @returns {Float32Array|Array} The same embedding reference, normalized
 */
export function l2Normalize(embedding) {
  if (!embedding || embedding.length === 0) return embedding;

  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);

  // Guard against zero/near-zero vectors to avoid NaN
  if (norm > 1e-10) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

/**
 * Create a new L2 normalized copy of an embedding
 * @param {Float32Array|Array} embedding - The embedding to copy and normalize
 * @returns {Float32Array|null} A new normalized Float32Array, or null if input is invalid
 */
export function l2NormalizeCopy(embedding) {
  if (!embedding || embedding.length === 0) return null;

  const copy = new Float32Array(embedding);
  return l2Normalize(copy);
}

/**
 * Calculate cosine similarity between two embedding vectors
 * For unit-normalized vectors, this is equivalent to the dot product
 * @param {Float32Array|Array} a - First embedding
 * @param {Float32Array|Array} b - Second embedding
 * @returns {number} Similarity score between -1 and 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}
