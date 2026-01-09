/**
 * Enrollment Manager
 * Handles voice enrollment workflow using the Rainbow Passage
 * Supports multiple speaker enrollments and re-recording of samples
 */

import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from '../core/embedding/embeddingUtils.js';
import { ENROLLMENT_DEFAULTS, RAINBOW_PASSAGES } from '../config/index.js';
import { EnrollmentStore } from '../storage/index.js';

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
   */
  addSample(embedding) {
    const normalizedEmbedding = l2NormalizeCopy(embedding);
    this.samples[this.currentGroupIndex] = normalizedEmbedding;
    // Auto-advance to next unrecorded group if available
    this.advanceToNextEmpty();
  }

  /**
   * Record or re-record a sample at a specific index
   * @param {number} index - Group index to record
   * @param {Float32Array|Array} embedding - The embedding to store
   */
  setSample(index, embedding) {
    if (index >= 0 && index < this.passages.length) {
      const normalizedEmbedding = l2NormalizeCopy(embedding);
      this.samples[index] = normalizedEmbedding;
    }
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
    this.speakerName = '';
    this.currentGroupIndex = 0;
    this.rejectedSamples = [];
    this.usedFallback = false;
  }

  // ==================== Static storage methods (delegates to EnrollmentStore) ====================

  /**
   * Migrate old single enrollment to new multi-enrollment format
   * Call this once on app startup
   */
  static migrateFromSingle() {
    return EnrollmentStore.migrateFromLegacy();
  }

  /**
   * Save all enrollments
   * @param {Array} enrollments - Array of {id, name, centroid, timestamp, colorIndex}
   */
  static saveAll(enrollments) {
    EnrollmentStore.saveAll(enrollments);
  }

  /**
   * Load all enrollments
   * @returns {Array} Array of enrollments or empty array
   */
  static loadAll() {
    return EnrollmentStore.getAll();
  }

  /**
   * Add a new enrollment
   * @param {string} name - Speaker name
   * @param {Float32Array|Array} embedding - Averaged embedding
   * @returns {Object} The created enrollment
   */
  static addEnrollment(name, embedding) {
    return EnrollmentStore.add(name, embedding);
  }

  /**
   * Remove an enrollment by ID
   * @param {string} id - Enrollment ID to remove
   * @returns {Array} Updated enrollments array
   */
  static removeEnrollment(id) {
    return EnrollmentStore.remove(id);
  }

  /**
   * Get count of enrollments
   * @returns {number}
   */
  static getEnrollmentCount() {
    return EnrollmentStore.count();
  }

  /**
   * Clear all enrollments
   */
  static clearAll() {
    EnrollmentStore.clear();
  }

  /**
   * Check if any enrollments exist
   * @returns {boolean}
   */
  static hasEnrollments() {
    return EnrollmentStore.hasEnrollments();
  }

  // Legacy methods for backward compatibility
  static save(name, embedding) {
    return this.addEnrollment(name, embedding);
  }

  static load() {
    const enrollments = this.loadAll();
    return enrollments.length > 0 ? enrollments[0] : null;
  }

  static clear() {
    this.clearAll();
  }

  static hasEnrollment() {
    return this.hasEnrollments();
  }
}
