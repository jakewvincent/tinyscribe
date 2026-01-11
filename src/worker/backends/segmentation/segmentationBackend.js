/**
 * Segmentation Backend Interface
 *
 * Defines the contract that all segmentation backends must implement.
 * This allows swapping between different segmentation approaches
 * (text-based phrase gap vs acoustic models) while keeping the worker
 * code backend-agnostic.
 *
 * Segmentation backends differ from embedding backends in that they:
 * - May work on text (word timestamps) or audio (waveform)
 * - Return segment boundaries with speaker IDs rather than embeddings
 * - May output overlapping speech regions (acoustic models)
 */

/**
 * @typedef {Object} AcousticSegment
 * @property {number} speakerId - Local speaker ID within this chunk (0, 1, 2, ...)
 * @property {number} start - Start time in seconds
 * @property {number} end - End time in seconds
 * @property {number} confidence - Confidence score (0-1)
 */

/**
 * @typedef {Object} TextGapSegment
 * @property {Array} words - Whisper word objects in this segment
 * @property {number} start - Start time in seconds (from first word)
 * @property {number} end - End time in seconds (from last word)
 * @property {number} acousticSpeakerId - Always -1 for text-gap (unknown)
 */

/**
 * @typedef {Object} SegmentationResult
 * @property {Array<AcousticSegment|TextGapSegment>} segments - Speaker segments
 * @property {number} audioDuration - Total audio duration in seconds
 * @property {'acoustic'|'text-gap'} method - Segmentation method used
 */

/**
 * @typedef {Object} SegmentationModelInfo
 * @property {string} id - Model identifier
 * @property {string} name - Human-readable name
 * @property {string} backend - Backend type
 * @property {number|null} maxSpeakers - Maximum speakers per chunk
 */

/**
 * Abstract base class for segmentation backends.
 * Implementations must override all abstract methods.
 */
export class SegmentationBackend {
  constructor() {
    if (this.constructor === SegmentationBackend) {
      throw new Error('SegmentationBackend is abstract and cannot be instantiated directly');
    }
    this.modelConfig = null;
    this.isLoaded = false;
    this.params = {}; // Runtime parameters
  }

  /**
   * Load the model
   * @param {import('../../../config/segmentation.js').SegmentationModelConfig} modelConfig - Model configuration
   * @param {function} [progressCallback] - Optional callback for loading progress
   * @param {Record<string, number>} [initialParams] - Initial parameter values
   * @returns {Promise<void>}
   */
  async load(modelConfig, progressCallback, initialParams) {
    throw new Error('load() must be implemented by subclass');
  }

  /**
   * Segment audio into speaker turns
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @param {Object} [options] - Additional options
   * @param {Array} [options.words] - Whisper words with timestamps (for text-gap backend)
   * @returns {Promise<SegmentationResult>}
   */
  async segment(audioFloat32, options = {}) {
    throw new Error('segment() must be implemented by subclass');
  }

  /**
   * Get information about the loaded model
   * @returns {SegmentationModelInfo|null}
   */
  getModelInfo() {
    if (!this.modelConfig) return null;
    return {
      id: this.modelConfig.id,
      name: this.modelConfig.name,
      backend: this.modelConfig.backend,
      maxSpeakers: this.modelConfig.maxSpeakers ?? null,
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
   * Get current parameters
   * @returns {Record<string, number>}
   */
  getParams() {
    return { ...this.params };
  }

  /**
   * Set parameters (merges with existing)
   * @param {Record<string, number>} newParams
   */
  setParams(newParams) {
    this.params = { ...this.params, ...newParams };
    console.log(`[${this.constructor.name}] Updated params:`, this.params);
  }

  /**
   * Dispose of model resources
   * @returns {Promise<void>}
   */
  async dispose() {
    // Override in subclass if cleanup is needed
    this.isLoaded = false;
    this.modelConfig = null;
    this.params = {};
  }
}

export default SegmentationBackend;
