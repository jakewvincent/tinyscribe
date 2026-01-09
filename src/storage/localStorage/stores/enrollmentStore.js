/**
 * Enrollment Store
 * Storage for speaker enrollment data with legacy migration support
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';

/**
 * @typedef {Object} SpeakerEnrollment
 * @property {string} id - Unique identifier
 * @property {string} name - Speaker name
 * @property {number[]} centroid - 512-dim embedding centroid
 * @property {number} timestamp - Creation timestamp
 * @property {number} colorIndex - Color index for UI (0-5)
 */

export const EnrollmentStore = {
  /**
   * Migrate from legacy single-enrollment format if needed
   * Call once on app startup
   */
  migrateFromLegacy() {
    const legacyData = LocalStorageAdapter.getString(
      LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENT_LEGACY
    );

    // Skip if no legacy data or already have new format data
    if (!legacyData || this.hasEnrollments()) {
      return false;
    }

    try {
      const parsed = JSON.parse(legacyData);
      const migrated = [{
        ...parsed,
        id: Date.now().toString(),
        colorIndex: 0,
      }];
      this.saveAll(migrated);
      LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENT_LEGACY);
      console.log('Migrated single enrollment to multi-enrollment format');
      return true;
    } catch (e) {
      console.error('Failed to migrate enrollment:', e);
      return false;
    }
  },

  /**
   * Get all enrollments
   * @returns {SpeakerEnrollment[]}
   */
  getAll() {
    return LocalStorageAdapter.getJSON(
      LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS,
      []
    );
  },

  /**
   * Save all enrollments (replaces existing)
   * @param {SpeakerEnrollment[]} enrollments
   * @returns {boolean} Success
   */
  saveAll(enrollments) {
    return LocalStorageAdapter.setJSON(
      LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS,
      enrollments
    );
  },

  /**
   * Add a new enrollment
   * @param {string} name - Speaker name
   * @param {Float32Array|number[]} centroid - Embedding centroid
   * @returns {SpeakerEnrollment} The created enrollment
   */
  add(name, centroid) {
    const enrollments = this.getAll();
    const newEnrollment = {
      id: Date.now().toString(),
      name,
      centroid: Array.from(centroid),
      timestamp: Date.now(),
      colorIndex: enrollments.length % 6,
    };
    enrollments.push(newEnrollment);
    this.saveAll(enrollments);
    return newEnrollment;
  },

  /**
   * Remove an enrollment by ID
   * @param {string} id - Enrollment ID
   * @returns {SpeakerEnrollment[]} Updated enrollments
   */
  remove(id) {
    const enrollments = this.getAll().filter((e) => e.id !== id);
    // Reassign color indices sequentially
    enrollments.forEach((e, i) => {
      e.colorIndex = i % 6;
    });
    this.saveAll(enrollments);
    return enrollments;
  },

  /**
   * Clear all enrollments
   * @returns {boolean} Success
   */
  clear() {
    return LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS);
  },

  /**
   * Check if any enrollments exist
   * @returns {boolean}
   */
  hasEnrollments() {
    return this.getAll().length > 0;
  },

  /**
   * Get enrollment count
   * @returns {number}
   */
  count() {
    return this.getAll().length;
  },

  /**
   * Get enrollment by ID
   * @param {string} id
   * @returns {SpeakerEnrollment|undefined}
   */
  getById(id) {
    return this.getAll().find((e) => e.id === id);
  },

  /**
   * Get enrollment by name
   * @param {string} name
   * @returns {SpeakerEnrollment|undefined}
   */
  getByName(name) {
    return this.getAll().find((e) => e.name === name);
  },
};

export default EnrollmentStore;
