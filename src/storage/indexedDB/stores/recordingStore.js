/**
 * Recording Store
 * IndexedDB storage for saved recordings with audio chunks
 */

import { IndexedDBAdapter } from '../indexedDBAdapter.js';
import { INDEXED_DB_CONFIG } from '../../keys.js';
import { RECORDING_DEFAULTS } from '../../../config/defaults.js';

const config = INDEXED_DB_CONFIG.RECORDINGS;

/**
 * @typedef {Object} RecordingMetadata
 * @property {string} id - UUID
 * @property {string} name - User-editable name
 * @property {number} createdAt - Unix timestamp (ms)
 * @property {number} duration - Total duration in seconds
 * @property {Object[]} segments - Transcript segments with speaker info
 * @property {Object[]} participants - Discovered speakers
 * @property {Object} enrollmentsSnapshot - Enrollments active at recording time
 * @property {number} numSpeakersConfig - Expected speakers setting used
 * @property {Object} metadata - Additional metadata (chunkCount, segmentCount, sizeBytes)
 */

/**
 * @typedef {Object} RecordingChunks
 * @property {string} recordingId - Foreign key to recording
 * @property {Object[]} chunks - Array of audio chunks with serialized audio
 * @property {Object[]} [transcriptionData] - Per-chunk raw Whisper output (words, merge info, debug)
 */

export class RecordingStore {
  constructor() {
    this.adapter = new IndexedDBAdapter(config.name, config.version);
  }

  /**
   * Initialize the database (creates schema if needed)
   * @returns {Promise<void>}
   */
  async init() {
    await this.adapter.open((db) => {
      // Recordings store (metadata only, for fast listing)
      if (!db.objectStoreNames.contains(config.stores.RECORDINGS)) {
        const recordingsStore = db.createObjectStore(config.stores.RECORDINGS, {
          keyPath: 'id',
        });
        recordingsStore.createIndex('createdAt', 'createdAt');
        recordingsStore.createIndex('name', 'name');
      }

      // Chunks store (audio data, loaded on demand)
      if (!db.objectStoreNames.contains(config.stores.CHUNKS)) {
        const chunksStore = db.createObjectStore(config.stores.CHUNKS, {
          keyPath: 'recordingId',
        });
        chunksStore.createIndex('recordingId', 'recordingId');
      }
    });
  }

  /**
   * Check if database is ready
   * @returns {boolean}
   */
  isReady() {
    return this.adapter.isOpen();
  }

  // ==================== Recording Methods ====================

  /**
   * Save a recording with its audio chunks and transcription data
   * @param {RecordingMetadata} recording - Recording metadata
   * @param {Object[]} chunks - Audio chunks (with serialized audio arrays)
   * @param {Object[]} [transcriptionData] - Per-chunk raw Whisper output
   * @returns {Promise<string>} The recording ID
   */
  async save(recording, chunks, transcriptionData = []) {
    // Save metadata
    await this.adapter.put(config.stores.RECORDINGS, recording);

    // Save chunks and transcription data separately
    await this.adapter.put(config.stores.CHUNKS, {
      recordingId: recording.id,
      chunks: chunks,
      transcriptionData: transcriptionData,
    });

    return recording.id;
  }

  /**
   * Get recording metadata by ID (without audio chunks)
   * @param {string} id
   * @returns {Promise<RecordingMetadata|undefined>}
   */
  async get(id) {
    return this.adapter.get(config.stores.RECORDINGS, id);
  }

  /**
   * Get recording with audio chunks and transcription data
   * @param {string} id
   * @returns {Promise<{recording: RecordingMetadata, chunks: Object[], transcriptionData: Object[]}|undefined>}
   */
  async getWithChunks(id) {
    const recording = await this.adapter.get(config.stores.RECORDINGS, id);
    if (!recording) return undefined;

    const chunksData = await this.adapter.get(config.stores.CHUNKS, id);
    return {
      recording,
      chunks: chunksData?.chunks || [],
      transcriptionData: chunksData?.transcriptionData || [],
    };
  }

  /**
   * Get all recordings (metadata only), sorted by createdAt descending
   * @returns {Promise<RecordingMetadata[]>}
   */
  async getAll() {
    const recordings = await this.adapter.getAll(config.stores.RECORDINGS);
    return recordings.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Update recording metadata (e.g., rename)
   * @param {string} id
   * @param {Partial<RecordingMetadata>} updates
   * @returns {Promise<void>}
   */
  async update(id, updates) {
    const recording = await this.adapter.get(config.stores.RECORDINGS, id);
    if (recording) {
      Object.assign(recording, updates);
      await this.adapter.put(config.stores.RECORDINGS, recording);
    }
  }

  /**
   * Delete a recording and its audio chunks
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    // Delete chunks first
    await this.adapter.delete(config.stores.CHUNKS, id);
    // Delete recording metadata
    await this.adapter.delete(config.stores.RECORDINGS, id);
  }

  // ==================== Cleanup Methods ====================

  /**
   * Keep only the N most recent recordings, delete older ones
   * @param {number} [maxRecordings] - Max to keep (defaults to config)
   * @returns {Promise<number>} Number of recordings deleted
   */
  async enforceMaxRecordings(maxRecordings = RECORDING_DEFAULTS.maxRecordings) {
    const recordings = await this.getAll();
    if (recordings.length <= maxRecordings) return 0;

    const toDelete = recordings.slice(maxRecordings);
    for (const recording of toDelete) {
      await this.delete(recording.id);
    }
    return toDelete.length;
  }

  /**
   * Get total storage usage estimate in bytes
   * @returns {Promise<number>}
   */
  async getStorageUsage() {
    const recordings = await this.getAll();
    return recordings.reduce((total, r) => total + (r.metadata?.sizeBytes || 0), 0);
  }

  /**
   * Clear all recordings and chunks
   * @returns {Promise<void>}
   */
  async clearAll() {
    await this.adapter.clearAll([config.stores.RECORDINGS, config.stores.CHUNKS]);
  }

  /**
   * Close the database connection
   */
  close() {
    this.adapter.close();
  }
}

export default RecordingStore;
