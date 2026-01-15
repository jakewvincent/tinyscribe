/**
 * Recording Store
 * IndexedDB storage for saved recordings with audio chunks and processing jobs
 *
 * Schema v2: Job-based architecture
 * - Recording is a container with audio chunks (shared) and multiple jobs
 * - Each job has its own settings, segments, and participants
 * - Lazy migration from v1 schema when loading old recordings
 */

import { IndexedDBAdapter } from '../indexedDBAdapter.js';
import { INDEXED_DB_CONFIG, RECORDING_SCHEMA_VERSION } from '../../keys.js';
import { RECORDING_DEFAULTS, CONVERSATION_INFERENCE_DEFAULTS } from '../../../config/defaults.js';
import {
  generateJobId,
  JOB_STATUS,
  ENROLLMENT_SOURCE,
} from '../../../config/jobDefaults.js';

const config = INDEXED_DB_CONFIG.RECORDINGS;

/**
 * @typedef {Object} Job
 * @property {string} id - UUID for the job
 * @property {string} name - User-editable job name
 * @property {boolean} nameCustomized - Whether name was manually edited (vs auto-generated)
 * @property {string} notes - User notes about this job
 * @property {'unprocessed'|'processing'|'processed'} status - Job status
 * @property {number} createdAt - When job was created
 * @property {number|null} processedAt - When processing completed
 * @property {Object} settings - Frozen settings for this job
 * @property {Object[]|null} segments - Processing results (null until processed)
 * @property {Object[]|null} participants - Speakers found (null until processed)
 */

/**
 * @typedef {Object} ChannelConfig
 * @property {number} id - Channel ID (0, 1, etc.)
 * @property {string} label - Channel label (e.g., "Input 1")
 * @property {number} expectedSpeakers - Expected speakers for this channel
 */

/**
 * @typedef {Object} RecordingV2
 * @property {string} id - UUID
 * @property {string} name - User-editable recording name
 * @property {number} createdAt - Unix timestamp (ms)
 * @property {number} duration - Total duration in seconds
 * @property {Object[]} enrollmentsSnapshot - Enrollments active at recording time
 * @property {ChannelConfig[]} [channelConfigs] - Per-channel audio input configs (optional for backward compat)
 * @property {Object} metadata - Additional metadata (chunkCount, sizeBytes)
 * @property {Job[]} jobs - Array of processing jobs
 * @property {string} activeJobId - Currently displayed job ID
 * @property {number} schemaVersion - Schema version (2)
 */

/**
 * @typedef {Object} RecordingChunks
 * @property {string} recordingId - Foreign key to recording
 * @property {Object[]} chunks - Array of audio chunks with serialized audio
 * @property {Object[]} [transcriptionData] - Per-chunk raw Whisper output
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
    await this.adapter.open((db, oldVersion, newVersion) => {
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

      // Note: We don't migrate on upgrade - we use lazy migration when loading
      // This avoids blocking the upgrade transaction with async operations
    });
  }

  /**
   * Check if database is ready
   * @returns {boolean}
   */
  isReady() {
    return this.adapter.isOpen();
  }

  // ==================== Schema Migration ====================

  /**
   * Migrate a v1 recording to v2 schema
   * Wraps existing processing result as the first job
   *
   * @param {Object} oldRecording - Recording in v1 format
   * @returns {RecordingV2} Recording in v2 format
   */
  migrateToV2(oldRecording) {
    // Create the first job from existing processing result
    const jobId = generateJobId();

    const defaultJob = {
      id: jobId,
      name: 'Original Processing',
      notes: '',
      status: JOB_STATUS.PROCESSED,
      createdAt: oldRecording.createdAt,
      processedAt: oldRecording.processingInfo?.processedAt || oldRecording.createdAt,
      settings: {
        embeddingModel: oldRecording.processingInfo?.embeddingModel || {
          id: 'wavlm-base-sv',
          name: 'WavLM Base+ SV',
          dimensions: 512,
        },
        segmentationModel: oldRecording.processingInfo?.segmentationModel || {
          id: 'phrase-gap',
          name: 'Text-based Phrase Gap',
        },
        segmentationParams: oldRecording.processingInfo?.segmentationParams || {
          gapThreshold: 0.2,
          minPhraseDuration: 0.5,
        },
        asrModel: oldRecording.processingInfo?.asrModel || {
          id: 'whisper-tiny.en',
          name: 'Whisper Tiny',
        },
        clustering: {
          similarityThreshold: 0.75,
          confidenceMargin: 0.15,
          numSpeakers: oldRecording.numSpeakersConfig || 2,
        },
        boosting: {
          boostFactor: CONVERSATION_INFERENCE_DEFAULTS.boostFactor,
          ambiguityMarginThreshold: CONVERSATION_INFERENCE_DEFAULTS.ambiguityMarginThreshold,
          skipBoostIfConfident: CONVERSATION_INFERENCE_DEFAULTS.skipBoostIfConfident,
          minSimilarityForBoosting: CONVERSATION_INFERENCE_DEFAULTS.minSimilarityForBoosting,
          boostEligibilityRank: CONVERSATION_INFERENCE_DEFAULTS.boostEligibilityRank,
          minSimilarityAfterBoost: CONVERSATION_INFERENCE_DEFAULTS.minSimilarityAfterBoost,
        },
        enrollmentSource: ENROLLMENT_SOURCE.SNAPSHOT,
      },
      segments: oldRecording.segments || [],
      participants: oldRecording.participants || [],
    };

    // Build v2 recording
    return {
      id: oldRecording.id,
      name: oldRecording.name,
      createdAt: oldRecording.createdAt,
      duration: oldRecording.duration,
      enrollmentsSnapshot: oldRecording.enrollmentsSnapshot || [],
      channelConfigs: [], // No channel config for legacy single-input recordings
      metadata: {
        chunkCount: oldRecording.metadata?.chunkCount || 0,
        sizeBytes: oldRecording.metadata?.sizeBytes || 0,
      },
      jobs: [defaultJob],
      activeJobId: jobId,
      schemaVersion: RECORDING_SCHEMA_VERSION,
    };
  }

  /**
   * Check if recording needs migration and migrate if so
   * @param {Object} recording
   * @returns {Promise<Object>} Migrated recording (or original if already v2)
   */
  async ensureMigrated(recording) {
    if (!recording) return recording;

    // Check if migration needed
    if (!recording.schemaVersion || recording.schemaVersion < RECORDING_SCHEMA_VERSION) {
      const migrated = this.migrateToV2(recording);
      // Save the migrated version
      await this.adapter.put(config.stores.RECORDINGS, migrated);
      return migrated;
    }

    return recording;
  }

  // ==================== Recording Methods ====================

  /**
   * Save a recording (v2 schema) with its audio chunks and transcription data
   * @param {RecordingV2} recording - Recording metadata with jobs
   * @param {Object[]} chunks - Audio chunks (with serialized audio arrays)
   * @param {Object[]} [transcriptionData] - Per-chunk raw Whisper output
   * @returns {Promise<string>} The recording ID
   */
  async save(recording, chunks, transcriptionData = []) {
    // Ensure schema version is set
    recording.schemaVersion = RECORDING_SCHEMA_VERSION;

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
   * Automatically migrates v1 recordings to v2
   * @param {string} id
   * @returns {Promise<RecordingV2|undefined>}
   */
  async get(id) {
    const recording = await this.adapter.get(config.stores.RECORDINGS, id);
    return this.ensureMigrated(recording);
  }

  /**
   * Get recording with audio chunks and transcription data
   * Automatically migrates v1 recordings to v2
   * @param {string} id
   * @returns {Promise<{recording: RecordingV2, chunks: Object[], transcriptionData: Object[]}|undefined>}
   */
  async getWithChunks(id) {
    let recording = await this.adapter.get(config.stores.RECORDINGS, id);
    if (!recording) return undefined;

    // Migrate if needed
    recording = await this.ensureMigrated(recording);

    const chunksData = await this.adapter.get(config.stores.CHUNKS, id);
    return {
      recording,
      chunks: chunksData?.chunks || [],
      transcriptionData: chunksData?.transcriptionData || [],
    };
  }

  /**
   * Get all recordings (metadata only), sorted by createdAt descending
   * Note: Does NOT auto-migrate - migration happens on individual load
   * @returns {Promise<RecordingV2[]>}
   */
  async getAll() {
    const recordings = await this.adapter.getAll(config.stores.RECORDINGS);
    return recordings.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Update recording metadata (e.g., rename)
   * @param {string} id
   * @param {Partial<RecordingV2>} updates
   * @returns {Promise<void>}
   */
  async update(id, updates) {
    let recording = await this.adapter.get(config.stores.RECORDINGS, id);
    if (recording) {
      recording = await this.ensureMigrated(recording);
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

  // ==================== Job Methods ====================

  /**
   * Get a specific job from a recording
   * @param {string} recordingId
   * @param {string} jobId
   * @returns {Promise<Job|undefined>}
   */
  async getJob(recordingId, jobId) {
    const recording = await this.get(recordingId);
    if (!recording) return undefined;
    return recording.jobs.find((j) => j.id === jobId);
  }

  /**
   * Get the active job for a recording
   * @param {string} recordingId
   * @returns {Promise<Job|undefined>}
   */
  async getActiveJob(recordingId) {
    const recording = await this.get(recordingId);
    if (!recording) return undefined;
    return recording.jobs.find((j) => j.id === recording.activeJobId);
  }

  /**
   * Add a new job to a recording
   * @param {string} recordingId
   * @param {Job} job - The job to add
   * @param {boolean} [setActive=true] - Whether to set this as the active job
   * @returns {Promise<void>}
   */
  async addJob(recordingId, job, setActive = true) {
    const recording = await this.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    recording.jobs.push(job);
    if (setActive) {
      recording.activeJobId = job.id;
    }

    await this.adapter.put(config.stores.RECORDINGS, recording);
  }

  /**
   * Update a job within a recording
   * @param {string} recordingId
   * @param {string} jobId
   * @param {Partial<Job>} updates
   * @returns {Promise<void>}
   */
  async updateJob(recordingId, jobId, updates) {
    const recording = await this.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const jobIndex = recording.jobs.findIndex((j) => j.id === jobId);
    if (jobIndex === -1) {
      throw new Error(`Job ${jobId} not found in recording ${recordingId}`);
    }

    Object.assign(recording.jobs[jobIndex], updates);
    await this.adapter.put(config.stores.RECORDINGS, recording);
  }

  /**
   * Save a complete job (updates if exists, errors if not found)
   * @param {string} recordingId
   * @param {Job} job
   * @returns {Promise<void>}
   */
  async saveJob(recordingId, job) {
    const recording = await this.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const jobIndex = recording.jobs.findIndex((j) => j.id === job.id);
    if (jobIndex === -1) {
      throw new Error(`Job ${job.id} not found in recording ${recordingId}`);
    }

    recording.jobs[jobIndex] = job;
    await this.adapter.put(config.stores.RECORDINGS, recording);
  }

  /**
   * Delete a job from a recording
   * @param {string} recordingId
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async deleteJob(recordingId, jobId) {
    const recording = await this.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    // Prevent deleting the last job
    if (recording.jobs.length <= 1) {
      throw new Error('Cannot delete the last job in a recording');
    }

    const jobIndex = recording.jobs.findIndex((j) => j.id === jobId);
    if (jobIndex === -1) {
      throw new Error(`Job ${jobId} not found in recording ${recordingId}`);
    }

    // Remove the job
    recording.jobs.splice(jobIndex, 1);

    // If we deleted the active job, set a new active job
    if (recording.activeJobId === jobId) {
      recording.activeJobId = recording.jobs[0].id;
    }

    await this.adapter.put(config.stores.RECORDINGS, recording);
  }

  /**
   * Set the active job for a recording
   * @param {string} recordingId
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async setActiveJob(recordingId, jobId) {
    const recording = await this.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const job = recording.jobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in recording ${recordingId}`);
    }

    recording.activeJobId = jobId;
    await this.adapter.put(config.stores.RECORDINGS, recording);
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
