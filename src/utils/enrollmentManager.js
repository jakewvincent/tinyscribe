/**
 * Enrollment Manager
 * Handles voice enrollment workflow using the Rainbow Passage
 * Supports multiple speaker enrollments and re-recording of samples
 */

import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from './embeddingUtils.js';

const STORAGE_KEY = 'speaker-enrollments';
const OUTLIER_SIMILARITY_THRESHOLD = 0.7;
const OLD_STORAGE_KEY = 'speaker-enrollment'; // For migration

// Rainbow Passage grouped into longer segments for reliable embeddings
// Each group should be ~30-45 words for 5+ seconds of speech
const RAINBOW_PASSAGES = [
  // Group 1: Sentences 1-2 (~29 words)
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors.',

  // Group 2: Sentences 3-4 (~35 words)
  'These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end.',

  // Group 3: Sentences 5-6 (~30 words)
  'People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow.',
];

const MIN_SAMPLES_REQUIRED = 3;

export class EnrollmentManager {
  constructor() {
    // Samples indexed by passage group (allows re-recording)
    // null = not recorded, Float32Array = recorded
    this.samples = new Array(RAINBOW_PASSAGES.length).fill(null);
    this.speakerName = '';
    this.currentGroupIndex = 0; // Which group is currently selected
    this.rejectedSamples = []; // Track samples rejected during centroid computation
    this.usedFallback = false; // True if >50% rejected and fallback was used
  }

  /**
   * Get all Rainbow Passage groups
   */
  getPassages() {
    return RAINBOW_PASSAGES;
  }

  /**
   * Get the current passage to read
   */
  getCurrentSentence() {
    return RAINBOW_PASSAGES[this.currentGroupIndex] || null;
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
    return RAINBOW_PASSAGES.length;
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
    if (index >= 0 && index < RAINBOW_PASSAGES.length) {
      const normalizedEmbedding = l2NormalizeCopy(embedding);
      this.samples[index] = normalizedEmbedding;
    }
  }

  /**
   * Select a specific group for recording/re-recording
   * @param {number} index - Group index to select
   */
  selectGroup(index) {
    if (index >= 0 && index < RAINBOW_PASSAGES.length) {
      this.currentGroupIndex = index;
    }
  }

  /**
   * Advance to the next empty (unrecorded) group
   * If all are recorded, stays at current position
   */
  advanceToNextEmpty() {
    // First try to find an empty slot after current position
    for (let i = this.currentGroupIndex + 1; i < RAINBOW_PASSAGES.length; i++) {
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
    if (this.currentGroupIndex < RAINBOW_PASSAGES.length - 1) {
      this.currentGroupIndex++;
    }
  }

  /**
   * Check if minimum samples collected
   */
  canComplete() {
    return this.getSampleCount() >= MIN_SAMPLES_REQUIRED;
  }

  /**
   * Check if all passages have been recorded
   */
  isComplete() {
    return this.getSampleCount() === RAINBOW_PASSAGES.length;
  }

  /**
   * Check if there are unrecorded passages
   */
  hasMoreSentences() {
    return this.getSampleCount() < RAINBOW_PASSAGES.length;
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
      if (similarity >= OUTLIER_SIMILARITY_THRESHOLD) {
        validSamples.push(sample);
      } else {
        this.rejectedSamples.push({ index: idx, sample, similarity });
        console.warn(
          `Enrollment: Outlier sample ${idx + 1} rejected (similarity ${similarity.toFixed(3)} < ${OUTLIER_SIMILARITY_THRESHOLD})`
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
    this.samples = new Array(RAINBOW_PASSAGES.length).fill(null);
    this.speakerName = '';
    this.currentGroupIndex = 0;
    this.rejectedSamples = [];
    this.usedFallback = false;
  }

  // ==================== Static localStorage methods (multi-enrollment) ====================

  /**
   * Migrate old single enrollment to new multi-enrollment format
   * Call this once on app startup
   */
  static migrateFromSingle() {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldData && !localStorage.getItem(STORAGE_KEY)) {
      try {
        const parsed = JSON.parse(oldData);
        const migrated = [{
          ...parsed,
          id: Date.now().toString(),
          colorIndex: 0,
        }];
        this.saveAll(migrated);
        localStorage.removeItem(OLD_STORAGE_KEY);
        console.log('Migrated single enrollment to multi-enrollment format');
      } catch (e) {
        console.error('Failed to migrate enrollment:', e);
      }
    }
  }

  /**
   * Save all enrollments to localStorage
   * @param {Array} enrollments - Array of {id, name, centroid, timestamp, colorIndex}
   */
  static saveAll(enrollments) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enrollments));
  }

  /**
   * Load all enrollments from localStorage
   * @returns {Array} Array of enrollments or empty array
   */
  static loadAll() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load enrollments:', e);
      return [];
    }
  }

  /**
   * Add a new enrollment
   * @param {string} name - Speaker name
   * @param {Float32Array|Array} embedding - Averaged embedding
   * @returns {Object} The created enrollment
   */
  static addEnrollment(name, embedding) {
    const enrollments = this.loadAll();
    const newEnrollment = {
      id: Date.now().toString(),
      name,
      centroid: Array.from(embedding),
      timestamp: Date.now(),
      colorIndex: enrollments.length % 6, // Cycle through 6 speaker colors
    };
    enrollments.push(newEnrollment);
    this.saveAll(enrollments);
    return newEnrollment;
  }

  /**
   * Remove an enrollment by ID
   * @param {string} id - Enrollment ID to remove
   * @returns {Array} Updated enrollments array
   */
  static removeEnrollment(id) {
    const enrollments = this.loadAll().filter((e) => e.id !== id);
    // Reassign color indices to keep them sequential
    enrollments.forEach((e, i) => {
      e.colorIndex = i % 6;
    });
    this.saveAll(enrollments);
    return enrollments;
  }

  /**
   * Get count of enrollments
   * @returns {number}
   */
  static getEnrollmentCount() {
    return this.loadAll().length;
  }

  /**
   * Clear all enrollments from localStorage
   */
  static clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Check if any enrollments exist
   * @returns {boolean}
   */
  static hasEnrollments() {
    return this.loadAll().length > 0;
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
