/**
 * Segmentation Model Selection Store
 * Persists user's selected segmentation model preference and model-specific parameters
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';
import {
  DEFAULT_SEGMENTATION_MODEL,
  SEGMENTATION_MODELS,
  getSegmentationModelConfig,
  getDefaultSegmentationParams,
} from '../../../config/segmentation.js';

// Storage key for model-specific params (stored as JSON object keyed by model ID)
const PARAMS_STORAGE_KEY = 'segmentation-model-params';

export const SegmentationModelStore = {
  /**
   * Get the selected segmentation model ID
   * Returns the default if none is stored or stored value is invalid
   * @returns {string} Model ID
   */
  getSegmentationModel() {
    const stored = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SEGMENTATION_MODEL_SELECTION);
    // Validate that the stored model ID is still valid
    if (stored && SEGMENTATION_MODELS[stored]) {
      return stored;
    }
    return DEFAULT_SEGMENTATION_MODEL;
  },

  /**
   * Migrate old defaults to new defaults (one-time migration)
   * Called on app startup
   */
  migrateOldDefaults() {
    const stored = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SEGMENTATION_MODEL_SELECTION);
    // If user had phrase-gap (old default), migrate to pyannote-seg-3 (new default)
    if (stored === 'phrase-gap') {
      console.log('[SegmentationModelStore] Migrating from old default (phrase-gap) to new default (pyannote-seg-3)');
      this.setSegmentationModel(DEFAULT_SEGMENTATION_MODEL);
    }
  },

  /**
   * Set the selected segmentation model ID
   * @param {string} modelId - Must be a valid model ID from SEGMENTATION_MODELS
   * @returns {boolean} Success
   */
  setSegmentationModel(modelId) {
    // Validate model ID before storing
    if (!SEGMENTATION_MODELS[modelId]) {
      console.warn(`Invalid segmentation model ID: ${modelId}`);
      return false;
    }
    return LocalStorageAdapter.setString(LOCAL_STORAGE_KEYS.SEGMENTATION_MODEL_SELECTION, modelId);
  },

  /**
   * Get the full config for the selected segmentation model
   * @returns {import('../../../config/segmentation.js').SegmentationModelConfig}
   */
  getSegmentationModelConfig() {
    const modelId = this.getSegmentationModel();
    return getSegmentationModelConfig(modelId);
  },

  /**
   * Clear the model selection (revert to default)
   * @returns {boolean} Success
   */
  clearSegmentationModel() {
    return LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.SEGMENTATION_MODEL_SELECTION);
  },

  /**
   * Check if user has explicitly selected a model (vs using default)
   * @returns {boolean}
   */
  hasExplicitSelection() {
    const stored = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SEGMENTATION_MODEL_SELECTION);
    return stored !== null && SEGMENTATION_MODELS[stored] !== undefined;
  },

  // ============ Model-Specific Parameters ============

  /**
   * Get all stored params (internal helper)
   * @returns {Record<string, Record<string, number>>} Object keyed by model ID
   */
  _getAllParams() {
    try {
      const stored = localStorage.getItem(PARAMS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[SegmentationModelStore] Failed to parse stored params:', e);
    }
    return {};
  },

  /**
   * Save all params (internal helper)
   * @param {Record<string, Record<string, number>>} allParams
   */
  _saveAllParams(allParams) {
    try {
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(allParams));
    } catch (e) {
      console.warn('[SegmentationModelStore] Failed to save params:', e);
    }
  },

  /**
   * Get params for a specific model, with defaults for any missing values
   * @param {string} modelId
   * @returns {Record<string, number>} Param values
   */
  getParams(modelId) {
    const defaults = getDefaultSegmentationParams(modelId);
    const allParams = this._getAllParams();
    const storedParams = allParams[modelId] || {};

    // Merge stored with defaults (stored takes precedence)
    return { ...defaults, ...storedParams };
  },

  /**
   * Get a single param value for a model
   * @param {string} modelId
   * @param {string} paramKey
   * @returns {number|undefined}
   */
  getParam(modelId, paramKey) {
    const params = this.getParams(modelId);
    return params[paramKey];
  },

  /**
   * Set params for a specific model (merges with existing)
   * @param {string} modelId
   * @param {Record<string, number>} params - Partial params to update
   * @returns {boolean} Success
   */
  setParams(modelId, params) {
    if (!SEGMENTATION_MODELS[modelId]) {
      console.warn(`[SegmentationModelStore] Invalid model ID: ${modelId}`);
      return false;
    }

    const allParams = this._getAllParams();
    allParams[modelId] = { ...(allParams[modelId] || {}), ...params };
    this._saveAllParams(allParams);
    return true;
  },

  /**
   * Set a single param value for a model
   * @param {string} modelId
   * @param {string} paramKey
   * @param {number} value
   * @returns {boolean} Success
   */
  setParam(modelId, paramKey, value) {
    return this.setParams(modelId, { [paramKey]: value });
  },

  /**
   * Reset params for a model to defaults
   * @param {string} modelId
   * @returns {boolean} Success
   */
  resetParams(modelId) {
    const allParams = this._getAllParams();
    delete allParams[modelId];
    this._saveAllParams(allParams);
    return true;
  },

  /**
   * Get params for the currently selected model
   * @returns {Record<string, number>}
   */
  getCurrentParams() {
    return this.getParams(this.getSegmentationModel());
  },

  /**
   * Check if a model has any custom (non-default) params
   * @param {string} modelId
   * @returns {boolean}
   */
  hasCustomParams(modelId) {
    const allParams = this._getAllParams();
    return allParams[modelId] !== undefined && Object.keys(allParams[modelId]).length > 0;
  },
};

export default SegmentationModelStore;
