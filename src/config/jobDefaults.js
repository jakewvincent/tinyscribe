/**
 * Job Settings Defaults
 *
 * Centralized defaults for processing job settings. Each job captures these
 * settings when created, and they become frozen after processing.
 *
 * This enables A/B testing different model combinations and parameters
 * on the same recording.
 */

import { CLUSTERING_DEFAULTS, CONVERSATION_INFERENCE_DEFAULTS } from './defaults.js';
import { DEFAULT_EMBEDDING_MODEL, getEmbeddingModelConfig } from './models.js';
import {
  DEFAULT_SEGMENTATION_MODEL,
  getSegmentationModelConfig,
  getDefaultSegmentationParams,
} from './segmentation.js';

/**
 * Default clustering settings for jobs
 */
export const JOB_CLUSTERING_DEFAULTS = {
  similarityThreshold: CLUSTERING_DEFAULTS.similarityThreshold,
  confidenceMargin: CLUSTERING_DEFAULTS.confidenceMargin,
  numSpeakers: 2, // Expected speakers
};

/**
 * Default boosting/inference settings for jobs
 * Subset of CONVERSATION_INFERENCE_DEFAULTS that are tunable per-job
 */
export const JOB_BOOSTING_DEFAULTS = {
  boostFactor: CONVERSATION_INFERENCE_DEFAULTS.boostFactor,
  ambiguityMarginThreshold: CONVERSATION_INFERENCE_DEFAULTS.ambiguityMarginThreshold,
  skipBoostIfConfident: CONVERSATION_INFERENCE_DEFAULTS.skipBoostIfConfident,
  minSimilarityForBoosting: CONVERSATION_INFERENCE_DEFAULTS.minSimilarityForBoosting,
  boostEligibilityRank: CONVERSATION_INFERENCE_DEFAULTS.boostEligibilityRank,
  minSimilarityAfterBoost: CONVERSATION_INFERENCE_DEFAULTS.minSimilarityAfterBoost,
};

/**
 * All job settings defaults combined
 */
export const JOB_SETTINGS_DEFAULTS = {
  clustering: JOB_CLUSTERING_DEFAULTS,
  boosting: JOB_BOOSTING_DEFAULTS,
};

/**
 * Job status enum
 * @readonly
 * @enum {string}
 */
export const JOB_STATUS = {
  LIVE: 'live', // Active live recording session
  UNPROCESSED: 'unprocessed',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
};

/**
 * Enrollment source options for jobs
 * @readonly
 * @enum {string}
 */
export const ENROLLMENT_SOURCE = {
  SNAPSHOT: 'snapshot', // Use enrollments captured when recording was made
  CURRENT: 'current', // Use current global enrollments
};

/**
 * Generate a unique job ID
 * @returns {string}
 */
export function generateJobId() {
  return crypto.randomUUID();
}

/**
 * Build complete job settings from current global state and optional overrides.
 * This captures the current model selections and parameter values.
 *
 * @param {Object} options - Optional overrides and current state
 * @param {string} [options.embeddingModelId] - Embedding model ID (uses default if not provided)
 * @param {string} [options.segmentationModelId] - Segmentation model ID (uses default if not provided)
 * @param {Object} [options.segmentationParams] - Segmentation parameters (uses model defaults if not provided)
 * @param {Object} [options.clustering] - Clustering settings overrides
 * @param {Object} [options.boosting] - Boosting settings overrides
 * @param {string} [options.enrollmentSource] - 'snapshot' or 'current'
 * @returns {Object} Complete JobSettings object
 */
export function buildJobSettings(options = {}) {
  // Get embedding model config
  const embeddingModelId = options.embeddingModelId || DEFAULT_EMBEDDING_MODEL;
  const embeddingConfig = getEmbeddingModelConfig(embeddingModelId);

  // Get segmentation model config
  const segmentationModelId = options.segmentationModelId || DEFAULT_SEGMENTATION_MODEL;
  const segmentationConfig = getSegmentationModelConfig(segmentationModelId);

  // Get segmentation params - use provided or get defaults for the model
  const segmentationParams =
    options.segmentationParams || getDefaultSegmentationParams(segmentationModelId);

  return {
    embeddingModel: {
      id: embeddingConfig.id,
      name: embeddingConfig.name,
      dimensions: embeddingConfig.dimensions,
    },
    segmentationModel: {
      id: segmentationConfig.id,
      name: segmentationConfig.name,
    },
    segmentationParams: { ...segmentationParams },
    asrModel: {
      id: 'whisper-tiny.en',
      name: 'Whisper Tiny',
    },
    clustering: {
      ...JOB_CLUSTERING_DEFAULTS,
      ...options.clustering,
    },
    boosting: {
      ...JOB_BOOSTING_DEFAULTS,
      ...options.boosting,
    },
    enrollmentSource: options.enrollmentSource || ENROLLMENT_SOURCE.SNAPSHOT,
  };
}

/**
 * Create a new job object with the given settings
 *
 * @param {Object} options
 * @param {string} [options.name] - Job name (defaults to auto-generated)
 * @param {string} [options.notes] - Job notes
 * @param {Object} [options.settings] - Job settings (built via buildJobSettings if not provided)
 * @param {string} [options.status] - Initial status (defaults to 'unprocessed')
 * @returns {Object} New job object
 */
export function createJob(options = {}) {
  const settings = options.settings || buildJobSettings();

  // Auto-generate name from model selection if not provided
  const autoName = generateJobName(settings);
  const nameCustomized = options.name ? true : false;

  return {
    id: generateJobId(),
    name: options.name || autoName,
    nameCustomized,
    notes: options.notes || '',
    status: options.status || JOB_STATUS.UNPROCESSED,
    createdAt: Date.now(),
    processedAt: null,
    settings,
    segments: null,
    participants: null,
  };
}

/**
 * Create a live job for the current recording session.
 * Live jobs have editable settings and represent the in-progress session.
 *
 * @param {Object} options - Same options as buildJobSettings
 * @returns {Object} New live job object
 */
export function createLiveJob(options = {}) {
  return createJob({
    name: 'Live Session',
    status: JOB_STATUS.LIVE,
    settings: buildJobSettings(options),
  });
}

/**
 * Generate a job name from its settings (embedding + segmentation model names)
 * @param {Object} settings - Job settings object
 * @returns {string} Auto-generated job name
 */
export function generateJobName(settings) {
  const embedName = settings.embeddingModel?.name?.replace(' SV', '') || 'Unknown';
  const segName = settings.segmentationModel?.name?.replace('Text-based ', '') || 'Unknown';
  return `${embedName} + ${segName}`;
}

/**
 * Clone a job's settings to create a new unprocessed job
 *
 * @param {Object} sourceJob - The job to clone settings from
 * @param {Object} [overrides] - Optional setting overrides
 * @returns {Object} New job object with cloned settings
 */
export function cloneJobSettings(sourceJob, overrides = {}) {
  const clonedSettings = {
    embeddingModel: { ...sourceJob.settings.embeddingModel },
    segmentationModel: { ...sourceJob.settings.segmentationModel },
    segmentationParams: { ...sourceJob.settings.segmentationParams },
    asrModel: { ...sourceJob.settings.asrModel },
    clustering: { ...sourceJob.settings.clustering, ...overrides.clustering },
    boosting: { ...sourceJob.settings.boosting, ...overrides.boosting },
    enrollmentSource: overrides.enrollmentSource || sourceJob.settings.enrollmentSource,
  };

  return createJob({
    name: `${sourceJob.name} (copy)`,
    notes: '',
    settings: clonedSettings,
    status: JOB_STATUS.UNPROCESSED,
  });
}

/**
 * Get a human-readable settings summary for display in dropdowns
 *
 * @param {Object} job - Job with settings
 * @returns {string} Short summary like "WavLM + Phrase Gap • 0.75/0.15"
 */
export function getJobSettingsSummary(job) {
  if (!job?.settings) return '';

  const embed = job.settings.embeddingModel?.name?.replace(' SV', '').replace('Base+ ', '') || '?';
  const seg =
    job.settings.segmentationModel?.name?.replace('Text-based ', '').replace(' Heuristic', '') ||
    '?';
  const sim = job.settings.clustering?.similarityThreshold?.toFixed(2) || '?';
  const margin = job.settings.clustering?.confidenceMargin?.toFixed(2) || '?';

  return `${embed} • ${seg} • ${sim}/${margin}`;
}

/**
 * Check if a job has notes
 * @param {Object} job
 * @returns {boolean}
 */
export function jobHasNotes(job) {
  return Boolean(job?.notes?.trim());
}

/**
 * Validate that job settings have all required fields
 * @param {Object} settings
 * @returns {boolean}
 */
export function validateJobSettings(settings) {
  if (!settings) return false;

  const required = [
    'embeddingModel',
    'segmentationModel',
    'segmentationParams',
    'asrModel',
    'clustering',
    'boosting',
    'enrollmentSource',
  ];

  for (const field of required) {
    if (!(field in settings)) return false;
  }

  // Check nested required fields
  if (!settings.embeddingModel?.id || !settings.embeddingModel?.name) return false;
  if (!settings.segmentationModel?.id || !settings.segmentationModel?.name) return false;
  if (!settings.asrModel?.id || !settings.asrModel?.name) return false;

  return true;
}

export default {
  JOB_CLUSTERING_DEFAULTS,
  JOB_BOOSTING_DEFAULTS,
  JOB_SETTINGS_DEFAULTS,
  JOB_STATUS,
  ENROLLMENT_SOURCE,
  generateJobId,
  buildJobSettings,
  createJob,
  createLiveJob,
  generateJobName,
  cloneJobSettings,
  getJobSettingsSummary,
  jobHasNotes,
  validateJobSettings,
};
