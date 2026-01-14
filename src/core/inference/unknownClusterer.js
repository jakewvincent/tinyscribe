/**
 * Unknown Speaker Clusterer
 *
 * Clusters segments that couldn't be confidently assigned to enrolled speakers.
 * Creates pseudo-speakers for multiple unknown voices, allowing differentiation
 * between different non-enrolled speakers in a conversation.
 *
 * Unlike SpeakerClusterer which works with enrolled speaker centroids,
 * UnknownClusterer builds centroids dynamically from segments assigned to
 * UNKNOWN_SPEAKER_ID (-1).
 */

import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from '../embedding/embeddingUtils.js';
import { UNKNOWN_CLUSTERING_DEFAULTS, UNKNOWN_SPEAKER_BASE } from '../../config/index.js';

/**
 * @typedef {Object} UnknownCluster
 * @property {number} id - Cluster ID (UNKNOWN_SPEAKER_BASE - index, e.g., -100, -101)
 * @property {Float32Array} centroid - Running average embedding for this cluster
 * @property {number} count - Number of segments in this cluster
 * @property {Array} closestEnrolledHistory - History of closest enrolled speaker per segment
 * @property {Object} closestEnrolledAggregate - Aggregated closest enrolled speaker info
 */

/**
 * @typedef {Object} UnknownClusterResult
 * @property {number} unknownId - Assigned unknown speaker ID
 * @property {Object} closestEnrolled - Info about closest enrolled speaker
 * @property {string} reason - Clustering reason ('unknown_new_cluster' or 'unknown_cluster_match')
 */

export class UnknownClusterer {
  /**
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    this.config = { ...UNKNOWN_CLUSTERING_DEFAULTS, ...config };

    /** @type {UnknownCluster[]} */
    this.clusters = [];

    // Track pending embeddings before first cluster is created
    this.pendingEmbeddings = [];
  }

  /**
   * Process a segment that was assigned UNKNOWN_SPEAKER_ID by SpeakerClusterer
   *
   * @param {Float32Array|Array} embedding - The segment's speaker embedding
   * @param {Array} enrolledSimilarities - Array of { speaker, similarity, enrolled } from clustering
   * @returns {UnknownClusterResult}
   */
  processUnknownSegment(embedding, enrolledSimilarities = []) {
    if (!embedding) {
      return {
        unknownId: UNKNOWN_SPEAKER_BASE,
        closestEnrolled: this._getClosestEnrolled(enrolledSimilarities),
        reason: 'no_embedding',
      };
    }

    // Find closest enrolled speaker from the similarity data
    const closestEnrolled = this._getClosestEnrolled(enrolledSimilarities);

    // If no clusters exist yet, create the first one
    if (this.clusters.length === 0) {
      return this._createNewCluster(embedding, closestEnrolled);
    }

    // Find best matching existing cluster
    const match = this._findBestClusterMatch(embedding);

    // Check if we should assign to existing cluster or create new one
    if (match.similarity >= this.config.similarityThreshold) {
      // Check margin if we have multiple clusters
      if (this.clusters.length > 1 && match.margin < this.config.confidenceMargin) {
        // Ambiguous between unknown clusters - still assign to best match but note ambiguity
        // (We still assign because all unknowns are equally "unknown")
      }

      // Assign to existing cluster and update centroid
      this._updateClusterCentroid(match.clusterIndex, embedding, closestEnrolled);

      return {
        unknownId: this.clusters[match.clusterIndex].id,
        closestEnrolled,
        reason: 'unknown_cluster_match',
        debug: {
          similarity: match.similarity,
          margin: match.margin,
          clusterCount: this.clusters.length,
        },
      };
    }

    // Similarity too low - create new cluster if under limit
    if (this.clusters.length < this.config.maxUnknownSpeakers) {
      return this._createNewCluster(embedding, closestEnrolled);
    }

    // At max clusters - assign to best match anyway
    this._updateClusterCentroid(match.clusterIndex, embedding, closestEnrolled);

    return {
      unknownId: this.clusters[match.clusterIndex].id,
      closestEnrolled,
      reason: 'unknown_cluster_match',
      debug: {
        similarity: match.similarity,
        margin: match.margin,
        clusterCount: this.clusters.length,
        forcedAssignment: true,
      },
    };
  }

  /**
   * Create a new unknown speaker cluster
   * @private
   */
  _createNewCluster(embedding, closestEnrolled) {
    const index = this.clusters.length;
    const id = UNKNOWN_SPEAKER_BASE - index;

    const cluster = {
      id,
      centroid: l2NormalizeCopy(embedding),
      count: 1,
      closestEnrolledHistory: closestEnrolled ? [closestEnrolled] : [],
      closestEnrolledAggregate: closestEnrolled ? { ...closestEnrolled } : null,
    };

    this.clusters.push(cluster);

    return {
      unknownId: id,
      closestEnrolled,
      reason: 'unknown_new_cluster',
      debug: {
        clusterIndex: index,
        clusterCount: this.clusters.length,
      },
    };
  }

  /**
   * Find the best matching cluster for an embedding
   * @private
   */
  _findBestClusterMatch(embedding) {
    let bestIndex = 0;
    let bestSimilarity = -1;
    let secondBestSimilarity = -1;

    for (let i = 0; i < this.clusters.length; i++) {
      const similarity = cosineSimilarity(embedding, this.clusters[i].centroid);
      if (similarity > bestSimilarity) {
        secondBestSimilarity = bestSimilarity;
        bestSimilarity = similarity;
        bestIndex = i;
      } else if (similarity > secondBestSimilarity) {
        secondBestSimilarity = similarity;
      }
    }

    return {
      clusterIndex: bestIndex,
      similarity: bestSimilarity,
      secondBestSimilarity: secondBestSimilarity,
      margin: bestSimilarity - (secondBestSimilarity >= 0 ? secondBestSimilarity : 0),
    };
  }

  /**
   * Update a cluster's centroid with a new embedding (running average)
   * @private
   */
  _updateClusterCentroid(clusterIndex, embedding, closestEnrolled) {
    const cluster = this.clusters[clusterIndex];
    const count = cluster.count;
    const centroid = cluster.centroid;

    // Normalize incoming embedding
    const normalizedEmbedding = l2NormalizeCopy(embedding);
    if (!normalizedEmbedding) return;

    // Running average: new_centroid = (old_centroid * count + new_embedding) / (count + 1)
    for (let i = 0; i < centroid.length; i++) {
      centroid[i] = (centroid[i] * count + normalizedEmbedding[i]) / (count + 1);
    }
    cluster.count++;

    // Re-normalize centroid after update
    l2Normalize(centroid);

    // Track closest enrolled history
    if (closestEnrolled) {
      cluster.closestEnrolledHistory.push(closestEnrolled);
      this._updateClosestEnrolledAggregate(cluster);
    }
  }

  /**
   * Update the aggregate closest enrolled speaker for a cluster
   * @private
   */
  _updateClosestEnrolledAggregate(cluster) {
    const history = cluster.closestEnrolledHistory;
    if (history.length === 0) {
      cluster.closestEnrolledAggregate = null;
      return;
    }

    // Count occurrences and sum similarities per enrolled speaker
    const speakerStats = new Map();

    for (const entry of history) {
      if (!entry || !entry.name) continue;

      if (!speakerStats.has(entry.name)) {
        speakerStats.set(entry.name, { count: 0, totalSimilarity: 0 });
      }
      const stats = speakerStats.get(entry.name);
      stats.count++;
      stats.totalSimilarity += entry.similarity;
    }

    // Find the most frequent closest enrolled speaker
    let bestName = null;
    let bestCount = 0;
    let bestAvgSimilarity = 0;

    for (const [name, stats] of speakerStats) {
      if (stats.count > bestCount ||
          (stats.count === bestCount && stats.totalSimilarity / stats.count > bestAvgSimilarity)) {
        bestName = name;
        bestCount = stats.count;
        bestAvgSimilarity = stats.totalSimilarity / stats.count;
      }
    }

    cluster.closestEnrolledAggregate = bestName ? {
      name: bestName,
      similarity: bestAvgSimilarity,
      occurrences: bestCount,
      totalSegments: history.length,
    } : null;
  }

  /**
   * Extract closest enrolled speaker from similarity array
   * @private
   */
  _getClosestEnrolled(enrolledSimilarities) {
    if (!enrolledSimilarities || enrolledSimilarities.length === 0) {
      return null;
    }

    // Filter to only enrolled speakers and find the best match
    const enrolled = enrolledSimilarities.filter(s => s.enrolled);
    if (enrolled.length === 0) return null;

    // Already sorted by similarity, take the first enrolled one
    const best = enrolled.reduce((a, b) => a.similarity > b.similarity ? a : b);

    return {
      name: best.speakerName || best.speaker,
      similarity: best.similarity,
    };
  }

  /**
   * Get cluster info for a specific unknown ID
   * @param {number} unknownId - Unknown speaker ID (e.g., -100)
   * @returns {Object|null}
   */
  getClusterInfo(unknownId) {
    const index = UNKNOWN_SPEAKER_BASE - unknownId;
    const cluster = this.clusters[index];

    if (!cluster) return null;

    return {
      id: cluster.id,
      label: this.getLabel(unknownId),
      segmentCount: cluster.count,
      closestEnrolled: cluster.closestEnrolledAggregate,
    };
  }

  /**
   * Get all unknown speakers meeting hypothesis thresholds
   * @returns {Array}
   */
  getAllUnknownSpeakers() {
    const { minSegmentsForCluster } = this.config;

    return this.clusters
      .filter(c => c.count >= minSegmentsForCluster)
      .map(c => ({
        speakerName: this.getLabel(c.id),
        unknownId: c.id,
        segmentCount: c.count,
        isUnknown: true,
        closestEnrolled: c.closestEnrolledAggregate,
        // Confidence for unknowns is based on cluster cohesion (approximated by count)
        confidence: Math.min(0.9, 0.5 + c.count * 0.05),
      }));
  }

  /**
   * Get label for an unknown speaker ID
   * @param {number} unknownId - Unknown speaker ID (e.g., -100)
   * @returns {string}
   */
  getLabel(unknownId) {
    const index = UNKNOWN_SPEAKER_BASE - unknownId;
    return `Unknown ${index + 1}`;
  }

  /**
   * Check if an ID is an unknown speaker ID
   * @param {number} speakerId
   * @returns {boolean}
   */
  static isUnknownId(speakerId) {
    return speakerId <= UNKNOWN_SPEAKER_BASE && speakerId !== -1;
  }

  /**
   * Serialize cluster state for persistence
   * @returns {Object}
   */
  serialize() {
    return {
      clusters: this.clusters.map(c => ({
        id: c.id,
        centroid: Array.from(c.centroid),
        count: c.count,
        closestEnrolledAggregate: c.closestEnrolledAggregate,
      })),
    };
  }

  /**
   * Restore cluster state from serialized data
   * @param {Object} data
   */
  restore(data) {
    if (!data || !data.clusters) return;

    this.clusters = data.clusters.map(c => ({
      id: c.id,
      centroid: new Float32Array(c.centroid),
      count: c.count,
      closestEnrolledHistory: [],
      closestEnrolledAggregate: c.closestEnrolledAggregate,
    }));
  }

  /**
   * Reset clusterer state
   */
  reset() {
    this.clusters = [];
    this.pendingEmbeddings = [];
  }

  /**
   * Get statistics for debugging
   */
  getStats() {
    return {
      clusterCount: this.clusters.length,
      clusters: this.clusters.map(c => ({
        id: c.id,
        label: this.getLabel(c.id),
        count: c.count,
        closestEnrolled: c.closestEnrolledAggregate,
      })),
    };
  }
}

export default UnknownClusterer;
