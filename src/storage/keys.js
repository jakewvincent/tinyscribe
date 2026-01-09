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

  // Speaker Enrollment
  SPEAKER_ENROLLMENTS: 'speaker-enrollments',
  SPEAKER_ENROLLMENT_LEGACY: 'speaker-enrollment', // For migration only

  // Debug Settings
  DEBUG_LOGGING_ENABLED: 'debug-logging-enabled',
  DEBUG_LOGGING_VERBOSE: 'debug-logging-verbose',
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
};

// Freeze to prevent accidental modification
Object.freeze(LOCAL_STORAGE_KEYS);
Object.freeze(INDEXED_DB_CONFIG.DEBUG_LOGS.stores);
Object.freeze(INDEXED_DB_CONFIG.DEBUG_LOGS);
Object.freeze(INDEXED_DB_CONFIG);
