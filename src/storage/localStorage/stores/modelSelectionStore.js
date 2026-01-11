/**
 * Model Selection Store
 * Persists user's selected embedding model preference
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  getEmbeddingModelConfig,
} from '../../../config/models.js';

export const ModelSelectionStore = {
  /**
   * Get the selected embedding model ID
   * Returns the default if none is stored or stored value is invalid
   * @returns {string} Model ID
   */
  getEmbeddingModel() {
    const stored = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.EMBEDDING_MODEL_SELECTION);
    // Validate that the stored model ID is still valid
    if (stored && EMBEDDING_MODELS[stored]) {
      return stored;
    }
    return DEFAULT_EMBEDDING_MODEL;
  },

  /**
   * Set the selected embedding model ID
   * @param {string} modelId - Must be a valid model ID from EMBEDDING_MODELS
   * @returns {boolean} Success
   */
  setEmbeddingModel(modelId) {
    // Validate model ID before storing
    if (!EMBEDDING_MODELS[modelId]) {
      console.warn(`Invalid embedding model ID: ${modelId}`);
      return false;
    }
    return LocalStorageAdapter.setString(LOCAL_STORAGE_KEYS.EMBEDDING_MODEL_SELECTION, modelId);
  },

  /**
   * Get the full config for the selected embedding model
   * @returns {import('../../../config/models.js').EmbeddingModelConfig}
   */
  getEmbeddingModelConfig() {
    const modelId = this.getEmbeddingModel();
    return getEmbeddingModelConfig(modelId);
  },

  /**
   * Clear the model selection (revert to default)
   * @returns {boolean} Success
   */
  clearEmbeddingModel() {
    return LocalStorageAdapter.remove(LOCAL_STORAGE_KEYS.EMBEDDING_MODEL_SELECTION);
  },

  /**
   * Check if user has explicitly selected a model (vs using default)
   * @returns {boolean}
   */
  hasExplicitSelection() {
    const stored = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.EMBEDDING_MODEL_SELECTION);
    return stored !== null && EMBEDDING_MODELS[stored] !== undefined;
  },
};

export default ModelSelectionStore;
