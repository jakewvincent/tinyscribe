/**
 * Enrollment Manager
 * Handles voice enrollment workflow using the Rainbow Passage
 * Supports multiple speaker enrollments and re-recording of samples
 */

import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from '../core/embedding/embeddingUtils.js';
import { ENROLLMENT_DEFAULTS, RAINBOW_PASSAGES } from '../config/index.js';
import { enrollmentStore, ModelSelectionStore } from '../storage/index.js';

export class EnrollmentManager {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string[]} [options.passages] - Custom passages for enrollment
   * @param {number} [options.minSamplesRequired] - Minimum samples to complete
   * @param {number} [options.outlierThreshold] - Similarity threshold for outlier detection
   */
  constructor(options = {}) {
    // Apply defaults from config
    const config = { ...ENROLLMENT_DEFAULTS, ...options };

    // Configuration
    this.passages = options.passages || RAINBOW_PASSAGES;
    this.minSamplesRequired = config.minSamplesRequired;
    this.outlierThreshold = config.outlierThreshold;

    // Samples indexed by passage group (allows re-recording)
    // null = not recorded, Float32Array = recorded
    this.samples = new Array(this.passages.length).fill(null);
    // Audio samples for each passage (allows recomputing embeddings when changing models)
    this.audioSamples = new Array(this.passages.length).fill(null);
    this.speakerName = '';
    this.currentGroupIndex = 0; // Which group is currently selected
    this.rejectedSamples = []; // Track samples rejected during centroid computation
    this.usedFallback = false; // True if >50% rejected and fallback was used
  }

  /**
   * Get all passage groups
   */
  getPassages() {
    return this.passages;
  }

  /**
   * Get the current passage to read
   */
  getCurrentSentence() {
    return this.passages[this.currentGroupIndex] || null;
  }

  /**
   * Get current group index (0-based)
   */
  getCurrentIndex() {
    return this.currentGroupIndex;
  }

  /**
   * Get total number of passage groups
   */
  getTotalSentences() {
    return this.passages.length;
  }

  /**
   * Get number of samples collected (non-null entries)
   */
  getSampleCount() {
    return this.samples.filter((s) => s !== null).length;
  }

  /**
   * Check if a specific group has been recorded
   * @param {number} index - Group index
   * @returns {boolean}
   */
  hasRecording(index) {
    return this.samples[index] !== null;
  }

  /**
   * Get the status of all recordings
   * @returns {Array<'empty'|'recorded'>}
   */
  getRecordingStatuses() {
    return this.samples.map((s) => (s !== null ? 'recorded' : 'empty'));
  }

  /**
   * Set the speaker name
   */
  setName(name) {
    this.speakerName = name.trim();
  }

  /**
   * Get the speaker name
   */
  getName() {
    return this.speakerName;
  }

  /**
   * Record or re-record a sample at the current group index
   * Normalizes the embedding before storing
   * @param {Float32Array|Array} embedding - The embedding to store
   * @param {Float32Array|Array} [audio] - Raw audio sample (for recomputing embeddings on model switch)
   */
  addSample(embedding, audio = null) {
    const normalizedEmbedding = l2NormalizeCopy(embedding);
    this.samples[this.currentGroupIndex] = normalizedEmbedding;
    if (audio) {
      this.audioSamples[this.currentGroupIndex] = audio instanceof Float32Array ? audio : new Float32Array(audio);
    }
    // Auto-advance to next unrecorded group if available
    this.advanceToNextEmpty();
  }

  /**
   * Record or re-record a sample at a specific index
   * @param {number} index - Group index to record
   * @param {Float32Array|Array} embedding - The embedding to store
   * @param {Float32Array|Array} [audio] - Raw audio sample
   */
  setSample(index, embedding, audio = null) {
    if (index >= 0 && index < this.passages.length) {
      const normalizedEmbedding = l2NormalizeCopy(embedding);
      this.samples[index] = normalizedEmbedding;
      if (audio) {
        this.audioSamples[index] = audio instanceof Float32Array ? audio : new Float32Array(audio);
      }
    }
  }

  /**
   * Get collected audio samples (non-null entries)
   * @returns {Float32Array[]}
   */
  getAudioSamples() {
    return this.audioSamples.filter((s) => s !== null);
  }

  /**
   * Select a specific group for recording/re-recording
   * @param {number} index - Group index to select
   */
  selectGroup(index) {
    if (index >= 0 && index < this.passages.length) {
      this.currentGroupIndex = index;
    }
  }

  /**
   * Advance to the next empty (unrecorded) group
   * If all are recorded, stays at current position
   */
  advanceToNextEmpty() {
    // First try to find an empty slot after current position
    for (let i = this.currentGroupIndex + 1; i < this.passages.length; i++) {
      if (this.samples[i] === null) {
        this.currentGroupIndex = i;
        return;
      }
    }
    // Then try from the beginning
    for (let i = 0; i < this.currentGroupIndex; i++) {
      if (this.samples[i] === null) {
        this.currentGroupIndex = i;
        return;
      }
    }
    // All slots filled - stay at current or move to end
    if (this.currentGroupIndex < this.passages.length - 1) {
      this.currentGroupIndex++;
    }
  }

  /**
   * Check if minimum samples collected
   */
  canComplete() {
    return this.getSampleCount() >= this.minSamplesRequired;
  }

  /**
   * Check if all passages have been recorded
   */
  isComplete() {
    return this.getSampleCount() === this.passages.length;
  }

  /**
   * Check if there are unrecorded passages
   */
  hasMoreSentences() {
    return this.getSampleCount() < this.passages.length;
  }

  /**
   * Compute average embedding from all samples with outlier rejection
   * Samples that are too dissimilar from the group are rejected to prevent
   * contamination from noise or different speakers
   * @returns {Float32Array|null}
   */
  computeAverageEmbedding() {
    // Filter out null entries (unrecorded groups)
    const recordedSamples = this.samples.filter((s) => s !== null);

    if (recordedSamples.length === 0) return null;

    const dim = recordedSamples[0].length;

    // Step 1: Compute initial centroid from all recorded samples
    const initialCentroid = new Float32Array(dim);
    for (const sample of recordedSamples) {
      for (let i = 0; i < dim; i++) {
        initialCentroid[i] += sample[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      initialCentroid[i] /= recordedSamples.length;
    }
    l2Normalize(initialCentroid);

    // Step 2: Reject outliers (similarity < threshold to initial centroid)
    const validSamples = [];
    this.rejectedSamples = [];

    for (let idx = 0; idx < recordedSamples.length; idx++) {
      const sample = recordedSamples[idx];
      const similarity = cosineSimilarity(sample, initialCentroid);
      if (similarity >= this.outlierThreshold) {
        validSamples.push(sample);
      } else {
        this.rejectedSamples.push({ index: idx, sample, similarity });
        console.warn(
          `Enrollment: Outlier sample ${idx + 1} rejected (similarity ${similarity.toFixed(3)} < ${this.outlierThreshold})`
        );
      }
    }

    // Step 3: Fallback if too many rejected (need at least 2 for meaningful average)
    const samplesToUse = validSamples.length >= 2 ? validSamples : recordedSamples;

    // Track if we had to use fallback due to >50% rejection
    const rejectionRatio = this.rejectedSamples.length / recordedSamples.length;
    this.usedFallback = validSamples.length < 2 && this.rejectedSamples.length > 0;

    if (this.usedFallback) {
      console.warn(
        `Enrollment: Too many outliers rejected (${this.rejectedSamples.length}/${recordedSamples.length}), using all samples`
      );
    } else if (rejectionRatio > 0.5) {
      // Even if we didn't fall back, warn if >50% were rejected
      this.usedFallback = true;
      console.warn(
        `Enrollment: High outlier rate (${this.rejectedSamples.length}/${recordedSamples.length} rejected), enrollment quality may be affected`
      );
    }

    // Step 4: Recompute centroid from valid samples only
    const avg = new Float32Array(dim);
    for (const sample of samplesToUse) {
      for (let i = 0; i < dim; i++) {
        avg[i] += sample[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      avg[i] /= samplesToUse.length;
    }

    // L2 normalize the final centroid
    return l2Normalize(avg);
  }

  /**
   * Get the number of samples rejected during last centroid computation
   * @returns {number}
   */
  getRejectedCount() {
    return this.rejectedSamples?.length || 0;
  }

  /**
   * Check if fallback was used due to high outlier rate (>50% rejected)
   * @returns {boolean}
   */
  hadHighOutlierRate() {
    return this.usedFallback;
  }

  /**
   * Reset enrollment state for new enrollment
   */
  reset() {
    this.samples = new Array(this.passages.length).fill(null);
    this.audioSamples = new Array(this.passages.length).fill(null);
    this.speakerName = '';
    this.currentGroupIndex = 0;
    this.rejectedSamples = [];
    this.usedFallback = false;
  }

  // ==================== Static storage methods (delegates to enrollmentStore) ====================

  /**
   * Initialize the enrollment store (must be called before other static methods)
   * @returns {Promise<void>}
   */
  static async init() {
    await enrollmentStore.init();
  }

  /**
   * Load all enrollments
   * @returns {Promise<Array>} Array of enrollments or empty array
   */
  static async loadAll() {
    return enrollmentStore.getAll();
  }

  /**
   * Add a new enrollment
   * @param {string} name - Speaker name
   * @param {Float32Array|Array} embedding - Averaged embedding
   * @param {Object} [options] - Additional options
   * @param {Array<Float32Array|number[]>} [options.audioSamples] - Raw audio samples for recomputing embeddings
   * @returns {Promise<Object>} The created enrollment
   */
  static async addEnrollment(name, embedding, options = {}) {
    const modelId = ModelSelectionStore.getEmbeddingModel();
    return enrollmentStore.add(name, embedding, {
      audioSamples: options.audioSamples,
      modelId,
    });
  }

  /**
   * Remove an enrollment by ID
   * @param {string} id - Enrollment ID to remove
   * @returns {Promise<Array>} Updated enrollments array
   */
  static async removeEnrollment(id) {
    return enrollmentStore.remove(id);
  }

  /**
   * Get count of enrollments
   * @returns {Promise<number>}
   */
  static async getEnrollmentCount() {
    return enrollmentStore.count();
  }

  /**
   * Clear all enrollments
   * @returns {Promise<void>}
   */
  static async clearAll() {
    return enrollmentStore.clear();
  }

  /**
   * Check if any enrollments exist
   * @returns {Promise<boolean>}
   */
  static async hasEnrollments() {
    return enrollmentStore.hasEnrollments();
  }

  /**
   * Get audio samples for an enrollment
   * @param {string} id - Enrollment ID
   * @returns {Promise<Float32Array[]|null>}
   */
  static async getAudioSamples(id) {
    return enrollmentStore.getAudioSamples(id);
  }

  /**
   * Check if enrollment has audio samples
   * @param {string} id - Enrollment ID
   * @returns {Promise<boolean>}
   */
  static async hasAudioSamples(id) {
    return enrollmentStore.hasAudioSamples(id);
  }

  /**
   * Get embedding for specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {Promise<Float32Array|null>}
   */
  static async getEmbeddingForModel(id, modelId) {
    return enrollmentStore.getEmbeddingForModel(id, modelId);
  }

  /**
   * Set embedding for specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @param {Float32Array|number[]} embedding - Embedding
   * @returns {Promise<boolean>}
   */
  static async setEmbeddingForModel(id, modelId, embedding) {
    return enrollmentStore.setEmbeddingForModel(id, modelId, embedding);
  }

  /**
   * Check if enrollment has embedding for specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {Promise<boolean>}
   */
  static async hasEmbeddingForModel(id, modelId) {
    return enrollmentStore.hasEmbeddingForModel(id, modelId);
  }

  /**
   * Get enrollments that need embedding computation for a model
   * @param {string} modelId - Model ID
   * @returns {Promise<Array>}
   */
  static async getEnrollmentsNeedingEmbeddings(modelId) {
    return enrollmentStore.getEnrollmentsNeedingEmbeddings(modelId);
  }

  // Legacy methods for backward compatibility
  static async save(name, embedding) {
    return this.addEnrollment(name, embedding);
  }

  static async load() {
    const enrollments = await this.loadAll();
    return enrollments.length > 0 ? enrollments[0] : null;
  }

  static async clear() {
    return this.clearAll();
  }

  static async hasEnrollment() {
    return this.hasEnrollments();
  }
}
