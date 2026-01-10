/**
 * Storage Module
 * Unified exports for all storage functionality
 */

// Keys
export { LOCAL_STORAGE_KEYS, INDEXED_DB_CONFIG } from './keys.js';

// LocalStorage
export {
  LocalStorageAdapter,
  PreferencesStore,
  EnrollmentStore,
  DebugSettingsStore,
} from './localStorage/index.js';

// IndexedDB
export { IndexedDBAdapter, DebugLogStore, RecordingStore } from './indexedDB/index.js';
