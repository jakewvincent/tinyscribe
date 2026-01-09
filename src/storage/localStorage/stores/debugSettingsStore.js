/**
 * Debug Settings Store
 * Storage for debug logging preferences
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';

/**
 * @typedef {Object} DebugSettings
 * @property {boolean} enabled - Whether debug logging is enabled
 * @property {boolean} verbose - Whether verbose mode is enabled
 */

export const DebugSettingsStore = {
  /**
   * Get debug logging enabled state
   * @returns {boolean}
   */
  isEnabled() {
    return LocalStorageAdapter.getBoolean(
      LOCAL_STORAGE_KEYS.DEBUG_LOGGING_ENABLED,
      false
    );
  },

  /**
   * Set debug logging enabled state
   * @param {boolean} enabled
   * @returns {boolean} Success
   */
  setEnabled(enabled) {
    return LocalStorageAdapter.setBoolean(
      LOCAL_STORAGE_KEYS.DEBUG_LOGGING_ENABLED,
      enabled
    );
  },

  /**
   * Get verbose mode state
   * @returns {boolean}
   */
  isVerbose() {
    return LocalStorageAdapter.getBoolean(
      LOCAL_STORAGE_KEYS.DEBUG_LOGGING_VERBOSE,
      false
    );
  },

  /**
   * Set verbose mode state
   * @param {boolean} verbose
   * @returns {boolean} Success
   */
  setVerbose(verbose) {
    return LocalStorageAdapter.setBoolean(
      LOCAL_STORAGE_KEYS.DEBUG_LOGGING_VERBOSE,
      verbose
    );
  },

  /**
   * Get all debug settings
   * @returns {DebugSettings}
   */
  getAll() {
    return {
      enabled: this.isEnabled(),
      verbose: this.isVerbose(),
    };
  },
};

export default DebugSettingsStore;
