/**
 * WorkerClient
 * Promise-based abstraction over the ML inference worker
 *
 * Provides a clean API for:
 * - Model loading with progress callbacks
 * - Transcription (audio → text with word timestamps)
 * - Speaker embedding extraction
 * - WebGPU capability detection
 */

export class WorkerClient {
  /**
   * @param {string} workerUrl - Path to the worker script
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.onStatus] - Status message callback
   * @param {Function} [options.onProgress] - Download progress callback
   * @param {Function} [options.onLoadingStage] - Loading stage callback
   * @param {Function} [options.onError] - Error callback
   */
  constructor(workerUrl, options = {}) {
    this.workerUrl = workerUrl;
    this.worker = null;
    this.isLoaded = false;

    // Callbacks for streaming updates
    this.onStatus = options.onStatus || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onLoadingStage = options.onLoadingStage || (() => {});
    this.onError = options.onError || console.error;

    // Pending requests (for promise-based API)
    this.pendingRequests = new Map();
    this.requestId = 0;
  }

  /**
   * Initialize the worker
   * @returns {WorkerClient} this instance for chaining
   */
  init() {
    if (this.worker) {
      return this;
    }

    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (error) => {
      this.onError(error);
      // Reject all pending requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(error);
        this.pendingRequests.delete(id);
      }
    };

    return this;
  }

  /**
   * Handle incoming messages from worker
   * @param {Object} data - Message data
   */
  handleMessage(data) {
    const { type, requestId } = data;

    // Handle streaming/status messages (no requestId)
    switch (type) {
      case 'status':
        this.onStatus(data.message);
        return;

      case 'progress':
        this.onProgress({
          file: data.file,
          loaded: data.loaded,
          total: data.total,
          progress: data.progress,
        });
        return;

      case 'loading-stage':
        this.onLoadingStage({
          stage: data.stage,
          message: data.message,
        });
        return;

      case 'error':
        // Errors without requestId are general errors
        if (!requestId) {
          this.onError(new Error(data.message));
          return;
        }
        break;
    }

    // Handle request/response messages (with requestId)
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      // Message for unknown request - might be a load completion
      if (type === 'status' && data.message?.includes('loaded')) {
        this.isLoaded = true;
      }
      return;
    }

    const { resolve, reject } = pending;
    this.pendingRequests.delete(requestId);

    switch (type) {
      case 'result':
        resolve({
          text: data.text,
          words: data.words,
          language: data.language,
        });
        break;

      case 'embedding-result':
        resolve(data.embedding);
        break;

      case 'transcription-validation-result':
        resolve({
          text: data.text,
          words: data.words,
        });
        break;

      case 'webgpu-check':
        resolve(data.available);
        break;

      case 'load-complete':
        this.isLoaded = true;
        resolve(true);
        break;

      case 'error':
        reject(new Error(data.message));
        break;

      default:
        // Unknown message type - resolve with full data
        resolve(data);
    }
  }

  /**
   * Send a message to the worker and wait for response
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   * @returns {Promise<any>} Response data
   */
  sendRequest(type, payload = {}) {
    if (!this.worker) {
      this.init();
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker.postMessage({
        type,
        requestId,
        ...payload,
      });
    });
  }

  /**
   * Check if WebGPU is available
   * @returns {Promise<boolean>} Whether WebGPU is available
   */
  async checkWebGPU() {
    return this.sendRequest('check-webgpu');
  }

  /**
   * Load the ML models
   * @param {string} [device='webgpu'] - Device to use ('webgpu' or 'wasm')
   * @returns {Promise<boolean>} Whether loading succeeded
   */
  async load(device = 'webgpu') {
    const result = await this.sendRequest('load', { device });
    this.isLoaded = true;
    return result;
  }

  /**
   * Transcribe audio to text with word timestamps
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @param {number} [chunkIndex] - Optional chunk index for tracking
   * @returns {Promise<{text: string, words: Array, language: string}>}
   */
  async transcribe(audio, chunkIndex) {
    if (!this.isLoaded) {
      throw new Error('Models not loaded. Call load() first.');
    }

    return this.sendRequest('transcribe', { audio, chunkIndex });
  }

  /**
   * Extract speaker embedding from audio
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @returns {Promise<Float32Array>} 512-dimensional speaker embedding
   */
  async extractEmbedding(audio) {
    if (!this.isLoaded) {
      throw new Error('Models not loaded. Call load() first.');
    }

    return this.sendRequest('extract-embedding', { audio });
  }

  /**
   * Transcribe audio for validation purposes (during enrollment)
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @returns {Promise<{text: string, words: Array}>}
   */
  async transcribeForValidation(audio) {
    if (!this.isLoaded) {
      throw new Error('Models not loaded. Call load() first.');
    }

    return this.sendRequest('transcribe-for-validation', { audio });
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isLoaded = false;
      this.pendingRequests.clear();
    }
  }
}
