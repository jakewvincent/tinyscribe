/**
 * Enrollment Manager
 * Handles voice enrollment workflow using the Rainbow Passage
 * Supports multiple speaker enrollments
 */

const STORAGE_KEY = 'speaker-enrollments';
const OLD_STORAGE_KEY = 'speaker-enrollment'; // For migration

const RAINBOW_SENTENCES = [
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  'The rainbow is a division of white light into many beautiful colors.',
  'These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon.',
  'There is, according to legend, a boiling pot of gold at one end.',
  'People look, but no one ever finds it.',
  'When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow.',
];

export class EnrollmentManager {
  constructor() {
    this.samples = []; // Array of embeddings (Float32Array or Array)
    this.speakerName = '';
    this.currentSentenceIndex = 0;
  }

  /**
   * Get all Rainbow Passage sentences
   */
  getSentences() {
    return RAINBOW_SENTENCES;
  }

  /**
   * Get the current sentence to read
   */
  getCurrentSentence() {
    return RAINBOW_SENTENCES[this.currentSentenceIndex] || null;
  }

  /**
   * Get current sentence index (0-based)
   */
  getCurrentIndex() {
    return this.currentSentenceIndex;
  }

  /**
   * Get total number of sentences
   */
  getTotalSentences() {
    return RAINBOW_SENTENCES.length;
  }

  /**
   * Get number of samples collected
   */
  getSampleCount() {
    return this.samples.length;
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
   * Add a sample embedding
   */
  addSample(embedding) {
    this.samples.push(embedding);
    this.currentSentenceIndex++;
  }

  /**
   * Skip current sentence without recording
   */
  skipSentence() {
    if (this.currentSentenceIndex < RAINBOW_SENTENCES.length) {
      this.currentSentenceIndex++;
    }
  }

  /**
   * Check if minimum samples collected (2+)
   */
  canComplete() {
    return this.samples.length >= 2;
  }

  /**
   * Check if all sentences have been processed
   */
  isComplete() {
    return this.currentSentenceIndex >= RAINBOW_SENTENCES.length;
  }

  /**
   * Check if there are more sentences available
   */
  hasMoreSentences() {
    return this.currentSentenceIndex < RAINBOW_SENTENCES.length;
  }

  /**
   * Compute average embedding from all samples
   * @returns {Float32Array|null}
   */
  computeAverageEmbedding() {
    if (this.samples.length === 0) return null;

    const dim = this.samples[0].length;
    const avg = new Float32Array(dim);

    for (const sample of this.samples) {
      for (let i = 0; i < dim; i++) {
        avg[i] += sample[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      avg[i] /= this.samples.length;
    }

    return avg;
  }

  /**
   * Reset enrollment state for new enrollment
   */
  reset() {
    this.samples = [];
    this.speakerName = '';
    this.currentSentenceIndex = 0;
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
