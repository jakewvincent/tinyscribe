/**
 * Discriminability Metrics
 * Functions to measure how well an embedding model separates different speakers
 */

import { cosineSimilarity } from './embeddingUtils.js';

/**
 * Compute mean pairwise cosine similarity between speaker centroids
 * Lower values indicate better discrimination (speakers are more distinct)
 * @param {Float32Array[]} centroids - Array of speaker centroid embeddings
 * @returns {number|null} Mean similarity, or null if < 2 speakers
 */
export function computeMeanPairwiseSimilarity(centroids) {
  if (!centroids || centroids.length < 2) return null;

  let sum = 0;
  let count = 0;

  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      sum += cosineSimilarity(centroids[i], centroids[j]);
      count++;
    }
  }

  return count > 0 ? sum / count : null;
}

/**
 * Compute minimum pairwise similarity (the most similar/confusable pair)
 * Higher min values indicate potential confusion between speakers
 * @param {Array<{name: string, centroid: Float32Array}>} speakers - Speakers with names and centroids
 * @returns {{similarity: number, pair: [string, string]}|null} Min similarity and the pair, or null if < 2 speakers
 */
export function computeMinPairwiseSimilarity(speakers) {
  if (!speakers || speakers.length < 2) return null;

  let maxSimilarity = -Infinity;
  let mostSimilarPair = null;

  for (let i = 0; i < speakers.length; i++) {
    for (let j = i + 1; j < speakers.length; j++) {
      const sim = cosineSimilarity(speakers[i].centroid, speakers[j].centroid);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        mostSimilarPair = [speakers[i].name, speakers[j].name];
      }
    }
  }

  return {
    similarity: maxSimilarity,
    pair: mostSimilarPair,
  };
}

/**
 * Compute silhouette score for speaker embeddings
 * Measures cluster quality: how similar samples are to own speaker vs other speakers
 * Range: -1 to 1, higher is better (well-separated clusters)
 *
 * @param {Array<{speakerId: string, embedding: Float32Array}>} samples - Individual sample embeddings with speaker IDs
 * @returns {number|null} Silhouette score, or null if insufficient data
 */
export function computeSilhouetteScore(samples) {
  if (!samples || samples.length < 2) return null;

  // Group samples by speaker
  const bySpeaker = new Map();
  for (const sample of samples) {
    if (!bySpeaker.has(sample.speakerId)) {
      bySpeaker.set(sample.speakerId, []);
    }
    bySpeaker.get(sample.speakerId).push(sample.embedding);
  }

  const speakerIds = Array.from(bySpeaker.keys());

  // Need at least 2 speakers
  if (speakerIds.length < 2) return null;

  // Check if any speaker has only 1 sample (can't compute intra-cluster distance)
  for (const [, embeddings] of bySpeaker) {
    if (embeddings.length < 2) {
      // Fall back to simplified calculation using centroids only
      return computeSimplifiedSilhouette(bySpeaker);
    }
  }

  let totalSilhouette = 0;
  let sampleCount = 0;

  for (const sample of samples) {
    const ownCluster = bySpeaker.get(sample.speakerId);

    // a(i) = mean distance to other samples in same cluster
    let a = 0;
    for (const other of ownCluster) {
      if (other !== sample.embedding) {
        a += 1 - cosineSimilarity(sample.embedding, other);
      }
    }
    a = a / (ownCluster.length - 1);

    // b(i) = min mean distance to samples in any other cluster
    let b = Infinity;
    for (const [otherId, otherCluster] of bySpeaker) {
      if (otherId === sample.speakerId) continue;

      let meanDist = 0;
      for (const other of otherCluster) {
        meanDist += 1 - cosineSimilarity(sample.embedding, other);
      }
      meanDist = meanDist / otherCluster.length;

      if (meanDist < b) {
        b = meanDist;
      }
    }

    // s(i) = (b - a) / max(a, b)
    const s = (b - a) / Math.max(a, b);
    totalSilhouette += s;
    sampleCount++;
  }

  return sampleCount > 0 ? totalSilhouette / sampleCount : null;
}

/**
 * Simplified silhouette when speakers have only 1 sample each
 * Uses centroid distances instead of sample-level distances
 * @param {Map<string, Float32Array[]>} bySpeaker - Samples grouped by speaker
 * @returns {number|null}
 */
function computeSimplifiedSilhouette(bySpeaker) {
  const speakerIds = Array.from(bySpeaker.keys());
  if (speakerIds.length < 2) return null;

  // Compute centroids
  const centroids = new Map();
  for (const [id, embeddings] of bySpeaker) {
    const dim = embeddings[0].length;
    const centroid = new Float32Array(dim);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += emb[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= embeddings.length;
    }
    centroids.set(id, centroid);
  }

  // For simplified version: use inter-centroid distances
  // This gives a rough measure of cluster separation
  let totalSeparation = 0;
  let count = 0;

  for (let i = 0; i < speakerIds.length; i++) {
    const id = speakerIds[i];
    const centroid = centroids.get(id);

    // Find nearest other centroid
    let nearestDist = Infinity;
    for (let j = 0; j < speakerIds.length; j++) {
      if (i === j) continue;
      const otherCentroid = centroids.get(speakerIds[j]);
      const dist = 1 - cosineSimilarity(centroid, otherCentroid);
      if (dist < nearestDist) {
        nearestDist = dist;
      }
    }

    // Normalize to [-1, 1] range (already in distance, so just use it)
    // Higher distance = better separation
    totalSeparation += nearestDist;
    count++;
  }

  // Scale to approximate silhouette range
  // Mean nearest-neighbor distance, scaled
  const avgSeparation = totalSeparation / count;
  // Transform distance [0, 2] to silhouette-like [-1, 1]
  // distance of 1 (orthogonal) -> 0, distance of 2 (opposite) -> 1, distance of 0 (identical) -> -1
  return avgSeparation - 1;
}

/**
 * Compute all discriminability metrics at once
 * @param {Array<{id: string, name: string, centroid: Float32Array, samples?: Float32Array[]}>} speakers
 *   Speakers with centroids and optionally individual sample embeddings
 * @returns {{meanSimilarity: number|null, minSimilarity: {similarity: number, pair: [string, string]}|null, silhouetteScore: number|null}}
 */
export function computeDiscriminabilityMetrics(speakers) {
  if (!speakers || speakers.length === 0) {
    return {
      meanSimilarity: null,
      minSimilarity: null,
      silhouetteScore: null,
    };
  }

  const centroids = speakers.map(s => s.centroid);
  const meanSimilarity = computeMeanPairwiseSimilarity(centroids);
  const minSimilarity = computeMinPairwiseSimilarity(speakers);

  // Build samples array for silhouette if individual samples are provided
  let silhouetteScore = null;
  const samplesForSilhouette = [];
  for (const speaker of speakers) {
    if (speaker.samples && speaker.samples.length > 0) {
      for (const emb of speaker.samples) {
        samplesForSilhouette.push({ speakerId: speaker.id, embedding: emb });
      }
    } else if (speaker.centroid) {
      // Fall back to using centroid as single sample
      samplesForSilhouette.push({ speakerId: speaker.id, embedding: speaker.centroid });
    }
  }

  if (samplesForSilhouette.length >= 2) {
    silhouetteScore = computeSilhouetteScore(samplesForSilhouette);
  }

  return {
    meanSimilarity,
    minSimilarity,
    silhouetteScore,
  };
}
