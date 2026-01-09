/**
 * LocalStorage Adapter
 * Thin wrapper around localStorage with consistent error handling
 * and automatic JSON serialization/deserialization.
 */

export const LocalStorageAdapter = {
  /**
   * Check if localStorage is available
   * @returns {boolean}
   */
  isAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get a raw string value
   * @param {string} key - Storage key
   * @returns {string|null}
   */
  getString(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  /**
   * Set a raw string value
   * @param {string} key - Storage key
   * @param {string} value - Value to store
   * @returns {boolean} Success
   */
  setString(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get a JSON-parsed value
   * @template T
   * @param {string} key - Storage key
   * @param {T} [defaultValue=null] - Default if not found or parse fails
   * @returns {T}
   */
  getJSON(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  /**
   * Set a value as JSON
   * @param {string} key - Storage key
   * @param {any} value - Value to serialize and store
   * @returns {boolean} Success
   */
  setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get a boolean value (stored as 'true'/'false' strings)
   * @param {string} key - Storage key
   * @param {boolean} [defaultValue=false] - Default if not found
   * @returns {boolean}
   */
  getBoolean(key, defaultValue = false) {
    const raw = this.getString(key);
    if (raw === null) return defaultValue;
    return raw === 'true';
  },

  /**
   * Set a boolean value
   * @param {string} key - Storage key
   * @param {boolean} value - Value to store
   * @returns {boolean} Success
   */
  setBoolean(key, value) {
    return this.setString(key, value ? 'true' : 'false');
  },

  /**
   * Remove a key
   * @param {string} key - Storage key
   * @returns {boolean} Success
   */
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Check if a key exists
   * @param {string} key - Storage key
   * @returns {boolean}
   */
  has(key) {
    return this.getString(key) !== null;
  },
};

export default LocalStorageAdapter;
