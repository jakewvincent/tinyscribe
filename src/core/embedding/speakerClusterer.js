/**
 * Speaker Clusterer
 * Uses speaker embeddings to cluster and identify unique speakers across audio chunks
 */

import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from './embeddingUtils.js';
import { CLUSTERING_DEFAULTS } from '../../config/index.js';

// Special speaker ID for unknown/unassignable speakers
export const UNKNOWN_SPEAKER_ID = -1;

export class SpeakerClusterer {
  /**
   * @param {number|Object} numSpeakersOrOptions - Number of speakers or options object
   * @param {Object} [options] - Configuration options (if first param is number)
   * @param {number} [options.numSpeakers=2] - Expected number of speakers
   * @param {number} [options.similarityThreshold] - Threshold for confident matching
   * @param {number} [options.minimumSimilarityThreshold] - Below this, assign to Unknown
   * @param {number} [options.confidenceMargin] - Min margin between best and second-best
   * @param {number} [options.interEnrollmentWarningThreshold] - Warn when enrolled speakers are too similar
   */
  constructor(numSpeakersOrOptions = 2, options = {}) {
    // Support both old API (number) and new API (options object)
    if (typeof numSpeakersOrOptions === 'object') {
      options = numSpeakersOrOptions;
      this.numSpeakers = options.numSpeakers || 2;
    } else {
      this.numSpeakers = numSpeakersOrOptions;
    }

    // Apply defaults from config
    const config = { ...CLUSTERING_DEFAULTS, ...options };

    // Each speaker has { centroid: Float32Array, count: number }
    this.speakers = [];
    // Similarity threshold for confident matching (cosine similarity)
    this.similarityThreshold = config.similarityThreshold;
    // Minimum similarity - below this, assign to Unknown (don't force match)
    this.minimumSimilarityThreshold = config.minimumSimilarityThreshold;
    // Minimum margin between best and second-best match to be confident
    this.confidenceMargin = config.confidenceMargin;
    // Threshold for warning about similar enrolled speakers
    this.interEnrollmentWarningThreshold = config.interEnrollmentWarningThreshold;
    // Debug logging flag - can be toggled via console: window.speakerClusterer.debugLogging = true
    this.debugLogging = options.debugLogging || false;
  }

  /**
   * Find the best and second-best matching speakers for an embedding
   * @param {Float32Array|Array} embedding - The speaker embedding
   * @returns {{ speakerId: number, similarity: number, secondBestSimilarity: number } | null}
   */
  findBestMatch(embedding) {
    if (!embedding || this.speakers.length === 0) return null;

    let bestSpeaker = -1;
    let bestSimilarity = -1;
    let secondBestSimilarity = -1;

    for (let i = 0; i < this.speakers.length; i++) {
      const similarity = cosineSimilarity(embedding, this.speakers[i].centroid);
      if (similarity > bestSimilarity) {
        secondBestSimilarity = bestSimilarity;
        bestSimilarity = similarity;
        bestSpeaker = i;
      } else if (similarity > secondBestSimilarity) {
        secondBestSimilarity = similarity;
      }
    }

    return { speakerId: bestSpeaker, similarity: bestSimilarity, secondBestSimilarity };
  }

  /**
   * Update speaker centroid with a new embedding (running average)
   * Normalizes input and maintains unit-norm centroid for consistent similarity scoring
   * @param {number} speakerId - The speaker ID
   * @param {Float32Array|Array} embedding - New embedding to incorporate
   */
  updateCentroid(speakerId, embedding) {
    if (!embedding || speakerId < 0 || speakerId >= this.speakers.length) return;

    const speaker = this.speakers[speakerId];
    const count = speaker.count;
    const centroid = speaker.centroid;

    // Normalize incoming embedding first
    const normalizedEmbedding = l2NormalizeCopy(embedding);
    if (!normalizedEmbedding) return;

    // Running average: new_centroid = (old_centroid * count + new_embedding) / (count + 1)
    for (let i = 0; i < centroid.length; i++) {
      centroid[i] = (centroid[i] * count + normalizedEmbedding[i]) / (count + 1);
    }
    speaker.count++;

    // Re-normalize centroid after update to maintain unit length
    l2Normalize(centroid);
  }

  /**
   * Assign a speaker ID to a segment based on its embedding
   * Uses online clustering: matches to existing speaker or creates new one
   * @param {Float32Array|Array} embedding - The speaker embedding
   * @param {boolean} returnDebug - If true, returns debug info along with ID
   * @returns {number|Object} Assigned speaker ID, or {speakerId, debug} if returnDebug
   */
  assignSpeaker(embedding, returnDebug = false) {
    const makeResult = (speakerId, debug = {}) => {
      if (returnDebug) {
        return { speakerId, debug };
      }
      return speakerId;
    };

    if (!embedding) {
      // No embedding - assign to speaker 0 by default
      return makeResult(0, {
        similarity: 0,
        secondBestSimilarity: 0,
        margin: 0,
        isEnrolled: false,
        reason: 'no_embedding',
      });
    }

    // If no speakers yet, create the first one
    if (this.speakers.length === 0) {
      this.speakers.push({
        centroid: l2NormalizeCopy(embedding),
        count: 1,
      });

      // Include allSimilarities so first segment contributes to hypothesis building
      const firstSpeaker = this.speakers[0];
      return makeResult(0, {
        similarity: 1,
        secondBestSimilarity: 0,
        margin: 1,
        isEnrolled: firstSpeaker.enrolled || false,
        reason: 'new_speaker',
        allSimilarities: [{
          speaker: firstSpeaker.name || 'Speaker 1',
          speakerIdx: 0,
          similarity: 1.0,
          enrolled: firstSpeaker.enrolled || false,
        }],
      });
    }

    // Find best matching speaker
    const match = this.findBestMatch(embedding);
    const margin = match.similarity - (match.secondBestSimilarity || 0);

    // Build debug info with ALL speaker similarities
    const allSimilarities = this.speakers.map((s, i) => ({
      speaker: s.name || `Speaker ${i + 1}`,
      speakerIdx: i,
      similarity: cosineSimilarity(embedding, s.centroid),
      enrolled: s.enrolled || false,
    }));

    const debug = {
      similarity: match.similarity,
      secondBestSimilarity: match.secondBestSimilarity || 0,
      margin: margin,
      isEnrolled: this.speakers[match.speakerId]?.enrolled || false,
      secondBestSpeaker: null,
      allSimilarities: allSimilarities, // Full breakdown
      reason: '',
    };

    // Find second-best speaker name if available
    if (this.speakers.length > 1 && match.secondBestSimilarity > 0) {
      for (let i = 0; i < this.speakers.length; i++) {
        if (i !== match.speakerId) {
          const sim = cosineSimilarity(embedding, this.speakers[i].centroid);
          if (Math.abs(sim - match.secondBestSimilarity) < 0.001) {
            debug.secondBestSpeaker = this.speakers[i].name || `Speaker ${i + 1}`;
            break;
          }
        }
      }
    }

    // If similarity is below minimum threshold, assign to Unknown
    // This prevents forcing bad matches onto enrolled speakers
    if (match.similarity < this.minimumSimilarityThreshold) {
      debug.reason = 'below_minimum_threshold';
      return makeResult(UNKNOWN_SPEAKER_ID, debug);
    }

    // If similarity is above threshold, consider assigning to that speaker
    if (match.similarity >= this.similarityThreshold) {
      // Check confidence margin when we have multiple speakers
      // The best match should be significantly better than second-best
      const hasMultipleSpeakers = this.speakers.length > 1;

      if (hasMultipleSpeakers && margin < this.confidenceMargin) {
        // Ambiguous match - similarities too close to be confident
        // Return Unknown rather than potentially wrong assignment
        debug.reason = 'ambiguous_match';
        return makeResult(UNKNOWN_SPEAKER_ID, debug);
      }

      // Confident match - only update centroid for non-enrolled speakers
      const speaker = this.speakers[match.speakerId];
      if (!speaker.enrolled) {
        this.updateCentroid(match.speakerId, embedding);
      }
      debug.reason = 'confident_match';
      return makeResult(match.speakerId, debug);
    }

    // If we haven't reached numSpeakers yet, create a new speaker
    if (this.speakers.length < this.numSpeakers) {
      const newId = this.speakers.length;
      this.speakers.push({
        centroid: l2NormalizeCopy(embedding),
        count: 1,
      });
      debug.reason = 'new_speaker';
      debug.similarity = 1;
      debug.margin = 1;
      return makeResult(newId, debug);
    }

    // We've reached max speakers and similarity is between minimum and threshold
    // Assign to Unknown rather than forcing a potentially incorrect match
    debug.reason = 'no_confident_match';
    return makeResult(UNKNOWN_SPEAKER_ID, debug);
  }

  /**
   * Process segments and assign consistent speaker IDs
   * @param {Array} segments - Segments with embeddings from diarization
   * @returns {Array} Segments with assigned speaker IDs
   */
  processSegments(segments) {
    return segments.map((segment) => {
      const speakerId = this.assignSpeaker(segment.embedding);
      return {
        ...segment,
        clusteredSpeakerId: speakerId,
      };
    });
  }

  /**
   * Process phrases and assign consistent speaker IDs
   * Handles null embeddings by inheriting from previous phrase or defaulting to 0
   * @param {Array} phrases - Phrases with embeddings from PhraseDetector
   * @returns {Array} Phrases with assigned speaker IDs and clustering debug info
   */
  processPhrases(phrases) {
    let lastSpeakerId = 0;
    let lastDebug = null;

    return phrases.map((phrase, idx) => {
      // If phrase has embedding, assign normally with debug info
      if (phrase.embedding) {
        const result = this.assignSpeaker(phrase.embedding, true);
        lastSpeakerId = result.speakerId;
        lastDebug = result.debug;

        // Debug log for each phrase assignment (toggleable)
        if (this.debugLogging) {
          const phraseText = phrase.words?.map(w => w.text).join('').trim().substring(0, 40);
          const allSimsStr = result.debug.allSimilarities
            ?.map(s => `${s.speaker}: ${s.similarity.toFixed(2)}`)
            .join(', ') || '';
          console.log(
            `🎤 Phrase ${idx}: "${phraseText}..." → ${this.getSpeakerLabel(result.speakerId)} ` +
            `(margin: ${result.debug.margin.toFixed(3)}) [${allSimsStr}]`
          );
        }

        return {
          ...phrase,
          clusteredSpeakerId: result.speakerId,
          clusteringDebug: result.debug,
        };
      }

      // No embedding (phrase too short) - inherit from previous or default
      return {
        ...phrase,
        clusteredSpeakerId: lastSpeakerId,
        clusteringDebug: lastDebug || {
          similarity: 0,
          secondBestSimilarity: 0,
          margin: 0,
          isEnrolled: false,
          reason: 'inherited',
        },
      };
    });
  }

  /**
   * Set the expected number of speakers
   * @param {number} n - Number of speakers
   */
  setNumSpeakers(n) {
    this.numSpeakers = Math.max(1, Math.min(n, 10));
  }

  /**
   * Get the current number of detected speakers
   * @returns {number}
   */
  getDetectedSpeakerCount() {
    return this.speakers.length;
  }

  /**
   * Reset the clusterer for a new recording session
   * @param {boolean} preserveEnrolled - If true, keeps all enrolled speakers
   */
  reset(preserveEnrolled = false) {
    if (preserveEnrolled) {
      // Keep only enrolled speakers
      this.speakers = this.speakers.filter((s) => s.enrolled);
    } else {
      this.speakers = [];
    }
  }

  /**
   * Get human-readable speaker label
   * Uses custom name if speaker was enrolled with one
   * @param {number} speakerId
   * @returns {string}
   */
  getSpeakerLabel(speakerId) {
    // Handle Unknown speaker
    if (speakerId === UNKNOWN_SPEAKER_ID) {
      return 'Unknown';
    }
    const speaker = this.speakers[speakerId];
    if (speaker?.name) {
      return speaker.name;
    }
    return `Speaker ${speakerId + 1}`;
  }

  /**
   * Pre-enroll a speaker with a known embedding
   * Enrolled speakers are added at the beginning and take priority in matching
   * @param {string} name - Custom name for the speaker
   * @param {Float32Array|Array} embedding - The speaker's voice embedding
   * @param {string} enrollmentId - Unique ID for this enrollment
   * @param {number} colorIndex - Color index for UI display
   */
  enrollSpeaker(name, embedding, enrollmentId = null, colorIndex = 0) {
    // Add enrolled speaker at the end of enrolled speakers (before discovered ones)
    const enrolledCount = this.getEnrolledCount();
    const newSpeaker = {
      centroid: l2NormalizeCopy(embedding),
      count: 1,
      name: name,
      enrolled: true,
      enrollmentId: enrollmentId || Date.now().toString(),
      colorIndex: colorIndex,
    };

    // Insert at the position after other enrolled speakers
    this.speakers.splice(enrolledCount, 0, newSpeaker);
  }

  /**
   * Check if we have any enrolled speakers
   * @returns {boolean}
   */
  hasEnrolledSpeaker() {
    return this.speakers.some((s) => s.enrolled);
  }

  /**
   * Get count of enrolled speakers
   * @returns {number}
   */
  getEnrolledCount() {
    return this.speakers.filter((s) => s.enrolled).length;
  }

  /**
   * Import all enrolled speakers from saved data
   * @param {Array} enrollments - Array of {id, name, centroid, colorIndex}
   * @returns {Array} Warnings about similar enrollments
   */
  importEnrolledSpeakers(enrollments) {
    if (!enrollments || !Array.isArray(enrollments)) return [];

    // Clear existing enrolled speakers
    this.speakers = this.speakers.filter((s) => !s.enrolled);

    // Add all enrollments at the beginning
    for (let i = enrollments.length - 1; i >= 0; i--) {
      const e = enrollments[i];
      if (!e.centroid) continue;

      // Normalize imported centroids for consistent similarity scoring
      this.speakers.unshift({
        centroid: l2NormalizeCopy(new Float32Array(e.centroid)),
        count: 1,
        name: e.name,
        enrolled: true,
        enrollmentId: e.id,
        colorIndex: e.colorIndex ?? i,
      });
    }

    // Check and log inter-speaker similarities for enrolled speakers
    return this.checkEnrolledSpeakerSimilarities(true);
  }

  /**
   * Check cosine similarities between all enrolled speaker centroids
   * Returns warnings for pairs that are too similar and may cause confusion
   * @param {boolean} force - Always log even if debugLogging is off
   * @returns {Array<{speaker1: string, speaker2: string, similarity: number}>} Warnings for similar enrollments
   */
  checkEnrolledSpeakerSimilarities(force = false) {
    const enrolled = this.speakers.filter((s) => s.enrolled);
    const warnings = [];

    if (enrolled.length < 2) return warnings;

    // Always log on first import (force=true) or when debugLogging is enabled
    const shouldLog = force || this.debugLogging;

    if (shouldLog) {
      console.group('Enrolled Speaker Centroid Similarities');
      console.log('WavLM-SV baseline: ~0.62 for different speakers, ~0.96 for same speaker.');

      // Diagnostic: Check centroid norms and dimensions
      for (const e of enrolled) {
        let norm = 0;
        for (let i = 0; i < e.centroid.length; i++) {
          norm += e.centroid[i] * e.centroid[i];
        }
        console.log(`  ${e.name}: dim=${e.centroid.length}, norm=${Math.sqrt(norm).toFixed(6)}`);
      }
    }

    for (let i = 0; i < enrolled.length; i++) {
      for (let j = i + 1; j < enrolled.length; j++) {
        const sim = cosineSimilarity(enrolled[i].centroid, enrolled[j].centroid);

        // Collect warnings for pairs above threshold
        if (sim > this.interEnrollmentWarningThreshold) {
          warnings.push({
            speaker1: enrolled[i].name,
            speaker2: enrolled[j].name,
            similarity: sim,
          });
        }

        if (shouldLog) {
          // WavLM-base-plus-sv typically shows ~0.62 for different speakers
          // so thresholds are calibrated accordingly
          const status = sim > 0.75 ? 'HIGH' : sim > 0.65 ? 'MODERATE' : 'NORMAL';
          console.log(`  ${enrolled[i].name} <-> ${enrolled[j].name}: ${sim.toFixed(3)} ${status}`);
        }
      }
    }

    if (shouldLog) {
      console.groupEnd();
    }

    return warnings;
  }

  /**
   * Legacy alias for checkEnrolledSpeakerSimilarities
   * @deprecated Use checkEnrolledSpeakerSimilarities instead
   */
  logEnrolledSpeakerSimilarities(force = false) {
    return this.checkEnrolledSpeakerSimilarities(force);
  }

  /**
   * Export all enrolled speakers for localStorage persistence
   * @returns {Array} Array of serializable enrollment data
   */
  exportEnrolledSpeakers() {
    return this.speakers
      .filter((s) => s.enrolled)
      .map((s) => ({
        id: s.enrollmentId,
        name: s.name,
        centroid: Array.from(s.centroid),
        colorIndex: s.colorIndex,
      }));
  }

  /**
   * Remove a specific enrolled speaker by enrollment ID
   * @param {string} enrollmentId - ID of enrollment to remove
   */
  removeEnrolledSpeaker(enrollmentId) {
    this.speakers = this.speakers.filter(
      (s) => !s.enrolled || s.enrollmentId !== enrollmentId
    );
  }

  /**
   * Clear all enrollments (keeps discovered speakers)
   */
  clearAllEnrollments() {
    this.speakers = this.speakers.filter((s) => !s.enrolled);
  }

  /**
   * Get all speakers (enrolled + discovered) for visualization
   * @returns {Array} Array of {id, name, centroid, enrolled, colorIndex}
   */
  getAllSpeakersForVisualization() {
    return this.speakers.map((s, i) => ({
      id: s.enrollmentId || `discovered-${i}`,
      name: s.name || `Speaker ${i + 1}`,
      centroid: s.centroid,
      enrolled: !!s.enrolled,
      colorIndex: s.colorIndex ?? i,
    }));
  }

  // Legacy methods for backward compatibility
  exportEnrolledSpeaker() {
    const enrolled = this.speakers.find((s) => s.enrolled);
    if (!enrolled) return null;
    return {
      name: enrolled.name,
      centroid: Array.from(enrolled.centroid),
    };
  }

  importEnrolledSpeaker(data) {
    if (!data || !data.centroid) return;
    this.importEnrolledSpeakers([{
      id: Date.now().toString(),
      name: data.name,
      centroid: data.centroid,
      colorIndex: 0,
    }]);
  }

  clearEnrollment() {
    this.clearAllEnrollments();
  }
}
