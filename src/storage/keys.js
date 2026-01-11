/**
 * Storage Keys
 * Centralized constants for all storage keys used across the application.
 * This prevents magic strings and documents all persisted data in one place.
 */

// localStorage keys
export const LOCAL_STORAGE_KEYS = {
  // UI Preferences
  SELECTED_MIC_DEVICE: 'selected-mic-device',
  PANEL_STATES: 'panel-states',
  WORKSPACE_TOP_PERCENT: 'workspace-top-percent',
  SIDEBAR_WIDTH: 'sidebar-width',

  // Speaker Enrollment
  SPEAKER_ENROLLMENTS: 'speaker-enrollments',
  SPEAKER_ENROLLMENT_LEGACY: 'speaker-enrollment', // For migration only

  // Debug Settings
  DEBUG_LOGGING_ENABLED: 'debug-logging-enabled',
  DEBUG_LOGGING_VERBOSE: 'debug-logging-verbose',

  // Model Selection
  EMBEDDING_MODEL_SELECTION: 'embedding-model-selection',
  SEGMENTATION_MODEL_SELECTION: 'segmentation-model-selection',
};

// IndexedDB configuration
export const INDEXED_DB_CONFIG = {
  DEBUG_LOGS: {
    name: 'transcription-debug',
    version: 1,
    stores: {
      SESSIONS: 'sessions',
      LOGS: 'logs',
    },
  },
  RECORDINGS: {
    name: 'transcription-recordings',
    version: 1,
    stores: {
      RECORDINGS: 'recordings',
      CHUNKS: 'recording-chunks',
    },
  },
};

// Freeze to prevent accidental modification
Object.freeze(LOCAL_STORAGE_KEYS);
Object.freeze(INDEXED_DB_CONFIG.DEBUG_LOGS.stores);
Object.freeze(INDEXED_DB_CONFIG.DEBUG_LOGS);
Object.freeze(INDEXED_DB_CONFIG.RECORDINGS.stores);
Object.freeze(INDEXED_DB_CONFIG.RECORDINGS);
Object.freeze(INDEXED_DB_CONFIG);
