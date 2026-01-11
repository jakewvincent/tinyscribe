/**
 * Enrollment Store
 * Storage for speaker enrollment data with legacy migration support
 *
 * Supports multi-model architecture:
 * - Stores raw audio samples from enrollment recordings
 * - Caches embeddings per model ID
 * - Allows re-computing embeddings when switching models
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';
import { DEFAULT_EMBEDDING_MODEL } from '../../../config/models.js';

/**
 * @typedef {Object} SpeakerEnrollment
 * @property {string} id - Unique identifier
 * @property {string} name - Speaker name
 * @property {number[]} centroid - Legacy: default model embedding centroid (for backward compat)
 * @property {Array<number[]>} [audioSamples] - Raw audio samples for each recording (allows recomputing embeddings)
 * @property {Object.<string, number[]>} [embeddings] - Embeddings keyed by model ID
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
   * @param {Object} [options] - Additional options
   * @param {Array<Float32Array|number[]>} [options.audioSamples] - Raw audio samples for recomputing embeddings
   * @param {string} [options.modelId] - Model ID used to compute the centroid
   * @returns {SpeakerEnrollment} The created enrollment
   */
  add(name, centroid, options = {}) {
    const { audioSamples, modelId = DEFAULT_EMBEDDING_MODEL } = options;
    const enrollments = this.getAll();

    const newEnrollment = {
      id: Date.now().toString(),
      name,
      centroid: Array.from(centroid),
      timestamp: Date.now(),
      colorIndex: enrollments.length % 6,
    };

    // Store audio samples if provided (for future model switching)
    if (audioSamples && audioSamples.length > 0) {
      newEnrollment.audioSamples = audioSamples.map((s) => Array.from(s));
    }

    // Store embedding with model ID key
    newEnrollment.embeddings = {
      [modelId]: Array.from(centroid),
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

  /**
   * Check if enrollment has audio samples for recomputing embeddings
   * @param {string} id - Enrollment ID
   * @returns {boolean}
   */
  hasAudioSamples(id) {
    const enrollment = this.getById(id);
    return !!(enrollment?.audioSamples && enrollment.audioSamples.length > 0);
  },

  /**
   * Get audio samples for an enrollment
   * @param {string} id - Enrollment ID
   * @returns {Float32Array[]|null} Audio samples or null if not available
   */
  getAudioSamples(id) {
    const enrollment = this.getById(id);
    if (!enrollment?.audioSamples) return null;
    return enrollment.audioSamples.map((s) => new Float32Array(s));
  },

  /**
   * Get cached embedding for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {Float32Array|null}
   */
  getEmbeddingForModel(id, modelId) {
    const enrollment = this.getById(id);
    if (!enrollment) return null;

    // Check per-model embeddings first
    if (enrollment.embeddings?.[modelId]) {
      return new Float32Array(enrollment.embeddings[modelId]);
    }

    // Fall back to centroid for legacy/default model
    if (modelId === DEFAULT_EMBEDDING_MODEL && enrollment.centroid) {
      return new Float32Array(enrollment.centroid);
    }

    return null;
  },

  /**
   * Cache an embedding for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @param {Float32Array|number[]} embedding - Computed embedding
   * @returns {boolean} Success
   */
  setEmbeddingForModel(id, modelId, embedding) {
    const enrollments = this.getAll();
    const index = enrollments.findIndex((e) => e.id === id);
    if (index === -1) return false;

    const enrollment = enrollments[index];
    if (!enrollment.embeddings) {
      enrollment.embeddings = {};
    }
    enrollment.embeddings[modelId] = Array.from(embedding);

    // Also update centroid if this is the default model
    if (modelId === DEFAULT_EMBEDDING_MODEL) {
      enrollment.centroid = Array.from(embedding);
    }

    return this.saveAll(enrollments);
  },

  /**
   * Check if embedding exists for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {boolean}
   */
  hasEmbeddingForModel(id, modelId) {
    const enrollment = this.getById(id);
    if (!enrollment) return false;

    if (enrollment.embeddings?.[modelId]) return true;
    if (modelId === DEFAULT_EMBEDDING_MODEL && enrollment.centroid) return true;

    return false;
  },

  /**
   * Get enrollments that need embedding computation for a model
   * @param {string} modelId - Model ID
   * @returns {SpeakerEnrollment[]} Enrollments missing embeddings for this model
   */
  getEnrollmentsNeedingEmbeddings(modelId) {
    return this.getAll().filter(
      (e) =>
        this.hasAudioSamples(e.id) && !this.hasEmbeddingForModel(e.id, modelId)
    );
  },

  /**
   * Get the embedding to use for an enrollment (for current model)
   * Returns the model-specific embedding if available, falls back to centroid
   * @param {string} id - Enrollment ID
   * @param {string} [modelId] - Model ID (defaults to DEFAULT_EMBEDDING_MODEL)
   * @returns {Float32Array|null}
   */
  getEffectiveEmbedding(id, modelId = DEFAULT_EMBEDDING_MODEL) {
    const embedding = this.getEmbeddingForModel(id, modelId);
    if (embedding) return embedding;

    // Fall back to centroid if no model-specific embedding
    const enrollment = this.getById(id);
    if (enrollment?.centroid) {
      return new Float32Array(enrollment.centroid);
    }

    return null;
  },
};

export default EnrollmentStore;
