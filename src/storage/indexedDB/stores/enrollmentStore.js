/**
 * Enrollment Store (IndexedDB)
 * Storage for speaker enrollment data with audio samples
 *
 * Stores:
 * - enrollments: Metadata, embeddings per model
 * - enrollment-audio-samples: Raw audio for re-computing embeddings
 */

import { IndexedDBAdapter } from '../indexedDBAdapter.js';
import { INDEXED_DB_CONFIG, LOCAL_STORAGE_KEYS } from '../../keys.js';
import { LocalStorageAdapter } from '../../localStorage/localStorageAdapter.js';
import { DEFAULT_EMBEDDING_MODEL } from '../../../config/models.js';

const config = INDEXED_DB_CONFIG.ENROLLMENTS;

/**
 * @typedef {Object} SpeakerEnrollment
 * @property {string} id - Unique identifier
 * @property {string} name - Speaker name
 * @property {number[]} centroid - Default model embedding centroid
 * @property {Object.<string, number[]>} [embeddings] - Embeddings keyed by model ID
 * @property {number} timestamp - Creation timestamp
 * @property {number} colorIndex - Color index for UI (0-5)
 */

/**
 * @typedef {Object} EnrollmentAudioSamples
 * @property {string} enrollmentId - Foreign key to enrollment
 * @property {number[][]} samples - Array of audio sample arrays
 */

export class EnrollmentStore {
  constructor() {
    this.adapter = new IndexedDBAdapter(config.name, config.version);
    this._initialized = false;
  }

  /**
   * Initialize the database (creates schema if needed)
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;

    await this.adapter.open((db) => {
      // Enrollments store (metadata and embeddings)
      if (!db.objectStoreNames.contains(config.stores.ENROLLMENTS)) {
        const enrollmentsStore = db.createObjectStore(config.stores.ENROLLMENTS, {
          keyPath: 'id',
        });
        enrollmentsStore.createIndex('name', 'name');
        enrollmentsStore.createIndex('timestamp', 'timestamp');
      }

      // Audio samples store (loaded on demand for model switching)
      if (!db.objectStoreNames.contains(config.stores.AUDIO_SAMPLES)) {
        db.createObjectStore(config.stores.AUDIO_SAMPLES, {
          keyPath: 'enrollmentId',
        });
      }
    });

    this._initialized = true;

    // Migrate from localStorage if needed
    await this._migrateFromLocalStorage();
  }

  /**
   * Migrate enrollments from localStorage to IndexedDB
   * @private
   */
  async _migrateFromLocalStorage() {
    const legacyData = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS);
    if (!legacyData) return;

    try {
      const enrollments = JSON.parse(legacyData);
      if (!Array.isArray(enrollments) || enrollments.length === 0) return;

      // Check if we already have data in IndexedDB
      const existing = await this.getAll();
      if (existing.length > 0) {
        // Already migrated, just clear localStorage
        LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS);
        console.log('[EnrollmentStore] Cleared legacy localStorage data');
        return;
      }

      console.log(`[EnrollmentStore] Migrating ${enrollments.length} enrollments from localStorage`);

      for (const enrollment of enrollments) {
        // Extract audio samples if present
        const audioSamples = enrollment.audioSamples;
        delete enrollment.audioSamples;

        // Save enrollment metadata
        await this.adapter.put(config.stores.ENROLLMENTS, enrollment);

        // Save audio samples separately if present
        if (audioSamples && audioSamples.length > 0) {
          await this.adapter.put(config.stores.AUDIO_SAMPLES, {
            enrollmentId: enrollment.id,
            samples: audioSamples,
          });
        }
      }

      // Clear localStorage after successful migration
      LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.SPEAKER_ENROLLMENTS);
      console.log('[EnrollmentStore] Migration complete, cleared localStorage');
    } catch (e) {
      console.error('[EnrollmentStore] Failed to migrate from localStorage:', e);
    }
  }

  /**
   * Check if database is ready
   * @returns {boolean}
   */
  isReady() {
    return this.adapter.isOpen();
  }

  // ==================== CRUD Operations ====================

  /**
   * Get all enrollments (without audio samples)
   * @returns {Promise<SpeakerEnrollment[]>}
   */
  async getAll() {
    if (!this._initialized) await this.init();
    return this.adapter.getAll(config.stores.ENROLLMENTS);
  }

  /**
   * Get enrollment by ID
   * @param {string} id
   * @returns {Promise<SpeakerEnrollment|undefined>}
   */
  async getById(id) {
    if (!this._initialized) await this.init();
    return this.adapter.get(config.stores.ENROLLMENTS, id);
  }

  /**
   * Get enrollment by name
   * @param {string} name
   * @returns {Promise<SpeakerEnrollment|undefined>}
   */
  async getByName(name) {
    if (!this._initialized) await this.init();
    const all = await this.getAll();
    return all.find((e) => e.name === name);
  }

  /**
   * Add a new enrollment
   * @param {string} name - Speaker name
   * @param {Float32Array|number[]} centroid - Embedding centroid
   * @param {Object} [options] - Additional options
   * @param {Array<Float32Array|number[]>} [options.audioSamples] - Raw audio samples
   * @param {string} [options.modelId] - Model ID used to compute the centroid
   * @returns {Promise<SpeakerEnrollment>} The created enrollment
   */
  async add(name, centroid, options = {}) {
    if (!this._initialized) await this.init();

    const { audioSamples, modelId = DEFAULT_EMBEDDING_MODEL } = options;
    const all = await this.getAll();

    const newEnrollment = {
      id: Date.now().toString(),
      name,
      centroid: Array.from(centroid),
      timestamp: Date.now(),
      colorIndex: all.length % 6,
      embeddings: {
        [modelId]: Array.from(centroid),
      },
    };

    // Save enrollment metadata
    await this.adapter.put(config.stores.ENROLLMENTS, newEnrollment);

    // Save audio samples separately if provided
    if (audioSamples && audioSamples.length > 0) {
      await this.adapter.put(config.stores.AUDIO_SAMPLES, {
        enrollmentId: newEnrollment.id,
        samples: audioSamples.map((s) => Array.from(s)),
      });
    }

    return newEnrollment;
  }

  /**
   * Update an enrollment
   * @param {SpeakerEnrollment} enrollment
   * @returns {Promise<void>}
   */
  async update(enrollment) {
    if (!this._initialized) await this.init();
    await this.adapter.put(config.stores.ENROLLMENTS, enrollment);
  }

  /**
   * Remove an enrollment by ID
   * @param {string} id - Enrollment ID
   * @returns {Promise<SpeakerEnrollment[]>} Updated enrollments array
   */
  async remove(id) {
    if (!this._initialized) await this.init();

    // Delete enrollment
    await this.adapter.delete(config.stores.ENROLLMENTS, id);

    // Delete associated audio samples
    await this.adapter.delete(config.stores.AUDIO_SAMPLES, id);

    // Reassign color indices
    const remaining = await this.getAll();
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].colorIndex !== i % 6) {
        remaining[i].colorIndex = i % 6;
        await this.adapter.put(config.stores.ENROLLMENTS, remaining[i]);
      }
    }

    return remaining;
  }

  /**
   * Clear all enrollments
   * @returns {Promise<void>}
   */
  async clear() {
    if (!this._initialized) await this.init();
    await this.adapter.clear(config.stores.ENROLLMENTS);
    await this.adapter.clear(config.stores.AUDIO_SAMPLES);
  }

  /**
   * Check if any enrollments exist
   * @returns {Promise<boolean>}
   */
  async hasEnrollments() {
    const all = await this.getAll();
    return all.length > 0;
  }

  /**
   * Get enrollment count
   * @returns {Promise<number>}
   */
  async count() {
    const all = await this.getAll();
    return all.length;
  }

  // ==================== Audio Sample Operations ====================

  /**
   * Check if enrollment has audio samples
   * @param {string} id - Enrollment ID
   * @returns {Promise<boolean>}
   */
  async hasAudioSamples(id) {
    if (!this._initialized) await this.init();
    const samples = await this.adapter.get(config.stores.AUDIO_SAMPLES, id);
    return !!(samples?.samples && samples.samples.length > 0);
  }

  /**
   * Get count of audio samples for an enrollment (without loading full data)
   * @param {string} id - Enrollment ID
   * @returns {Promise<number>}
   */
  async getAudioSampleCount(id) {
    if (!this._initialized) await this.init();
    const data = await this.adapter.get(config.stores.AUDIO_SAMPLES, id);
    return data?.samples?.length || 0;
  }

  /**
   * Get audio samples for an enrollment
   * @param {string} id - Enrollment ID
   * @returns {Promise<Float32Array[]|null>}
   */
  async getAudioSamples(id) {
    if (!this._initialized) await this.init();
    const data = await this.adapter.get(config.stores.AUDIO_SAMPLES, id);
    if (!data?.samples) return null;
    return data.samples.map((s) => new Float32Array(s));
  }

  // ==================== Embedding Operations ====================

  /**
   * Get cached embedding for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {Promise<Float32Array|null>}
   */
  async getEmbeddingForModel(id, modelId) {
    const enrollment = await this.getById(id);
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
  }

  /**
   * Cache an embedding for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @param {Float32Array|number[]} embedding - Computed embedding
   * @returns {Promise<boolean>}
   */
  async setEmbeddingForModel(id, modelId, embedding) {
    const enrollment = await this.getById(id);
    if (!enrollment) return false;

    if (!enrollment.embeddings) {
      enrollment.embeddings = {};
    }
    enrollment.embeddings[modelId] = Array.from(embedding);

    // Also update centroid if this is the default model
    if (modelId === DEFAULT_EMBEDDING_MODEL) {
      enrollment.centroid = Array.from(embedding);
    }

    await this.update(enrollment);
    return true;
  }

  /**
   * Check if embedding exists for a specific model
   * @param {string} id - Enrollment ID
   * @param {string} modelId - Model ID
   * @returns {Promise<boolean>}
   */
  async hasEmbeddingForModel(id, modelId) {
    const enrollment = await this.getById(id);
    if (!enrollment) return false;

    if (enrollment.embeddings?.[modelId]) return true;
    if (modelId === DEFAULT_EMBEDDING_MODEL && enrollment.centroid) return true;

    return false;
  }

  /**
   * Get enrollments that need embedding computation for a model
   * @param {string} modelId - Model ID
   * @returns {Promise<SpeakerEnrollment[]>}
   */
  async getEnrollmentsNeedingEmbeddings(modelId) {
    const all = await this.getAll();
    const results = [];

    for (const enrollment of all) {
      const hasAudio = await this.hasAudioSamples(enrollment.id);
      const hasEmbedding = await this.hasEmbeddingForModel(enrollment.id, modelId);
      if (hasAudio && !hasEmbedding) {
        results.push(enrollment);
      }
    }

    return results;
  }

  /**
   * Get the effective embedding for an enrollment (for current model)
   * @param {string} id - Enrollment ID
   * @param {string} [modelId] - Model ID (defaults to DEFAULT_EMBEDDING_MODEL)
   * @returns {Promise<Float32Array|null>}
   */
  async getEffectiveEmbedding(id, modelId = DEFAULT_EMBEDDING_MODEL) {
    const embedding = await this.getEmbeddingForModel(id, modelId);
    if (embedding) return embedding;

    // Fall back to centroid
    const enrollment = await this.getById(id);
    if (enrollment?.centroid) {
      return new Float32Array(enrollment.centroid);
    }

    return null;
  }

  // ==================== Visualization Operations ====================

  /**
   * Get all embedding model IDs that have stored embeddings across all enrollments
   * @returns {Promise<string[]>} Array of model IDs
   */
  async getAvailableEmbeddingModels() {
    const all = await this.getAll();
    const modelIds = new Set();

    for (const enrollment of all) {
      // Add models from the embeddings object
      if (enrollment.embeddings) {
        for (const modelId of Object.keys(enrollment.embeddings)) {
          modelIds.add(modelId);
        }
      }
      // Also check legacy centroid (implies DEFAULT_EMBEDDING_MODEL)
      if (enrollment.centroid && !enrollment.embeddings?.[DEFAULT_EMBEDDING_MODEL]) {
        modelIds.add(DEFAULT_EMBEDDING_MODEL);
      }
    }

    return Array.from(modelIds);
  }

  /**
   * Get enrollment data formatted for visualization with a specific model's embeddings
   * @param {string} modelId - Model ID to get embeddings for
   * @returns {Promise<Array<{id: string, name: string, centroid: Float32Array, colorIndex: number}>>}
   */
  async getEnrollmentsForVisualization(modelId) {
    const all = await this.getAll();
    const results = [];

    for (let i = 0; i < all.length; i++) {
      const enrollment = all[i];
      const embedding = await this.getEmbeddingForModel(enrollment.id, modelId);

      if (embedding) {
        results.push({
          id: enrollment.id,
          name: enrollment.name,
          centroid: embedding,
          colorIndex: enrollment.colorIndex ?? i,
          enrolled: true,
        });
      }
    }

    return results;
  }
}

// Singleton instance
export const enrollmentStore = new EnrollmentStore();

export default enrollmentStore;
