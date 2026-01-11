/**
 * Embedding Backend Interface
 *
 * Defines the contract that all embedding backends must implement.
 * This allows swapping between different inference engines (Transformers.js, sherpa-onnx)
 * while keeping the worker code backend-agnostic.
 */

/**
 * @typedef {Object} ModelInfo
 * @property {string} id - Model identifier
 * @property {string} name - Human-readable name
 * @property {number} dimensions - Embedding dimensions
 * @property {string} backend - Backend type ('transformers-js' | 'sherpa-onnx')
 */

/**
 * Abstract base class for embedding backends.
 * Implementations must override all methods.
 */
export class EmbeddingBackend {
  constructor() {
    if (this.constructor === EmbeddingBackend) {
      throw new Error('EmbeddingBackend is abstract and cannot be instantiated directly');
    }
    this.modelConfig = null;
    this.isLoaded = false;
  }

  /**
   * Load the model
   * @param {import('../../config/models.js').EmbeddingModelConfig} modelConfig - Model configuration
   * @param {function} [progressCallback] - Optional callback for loading progress
   * @returns {Promise<void>}
   */
  async load(modelConfig, progressCallback) {
    throw new Error('load() must be implemented by subclass');
  }

  /**
   * Extract speaker embedding from audio
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @returns {Promise<Float32Array|null>} Embedding vector or null on failure
   */
  async extractEmbedding(audioFloat32) {
    throw new Error('extractEmbedding() must be implemented by subclass');
  }

  /**
   * Get information about the loaded model
   * @returns {ModelInfo|null}
   */
  getModelInfo() {
    if (!this.modelConfig) return null;
    return {
      id: this.modelConfig.id,
      name: this.modelConfig.name,
      dimensions: this.modelConfig.dimensions,
      backend: this.modelConfig.backend,
    };
  }

  /**
   * Check if model is loaded and ready
   * @returns {boolean}
   */
  isReady() {
    return this.isLoaded;
  }

  /**
   * Dispose of model resources
   * @returns {Promise<void>}
   */
  async dispose() {
    // Override in subclass if cleanup is needed
    this.isLoaded = false;
    this.modelConfig = null;
  }
}

export default EmbeddingBackend;
