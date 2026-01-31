/**
 * Web Worker for ASR and Speaker Diarization
 * Runs Whisper and WavLM models in a separate thread to keep UI responsive.
 * Uses phrase-based diarization: Whisper word timestamps + WavLM frame features.
 */

import { pipeline, env as transformersEnv } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

import { TransformersBackend, OnnxBackend } from './worker/backends/index.js';
import { PhraseGapBackend, PyannoteSegBackend, OnnxSegBackend } from './worker/backends/segmentation/index.js';
import { mapWordsToSegments } from './core/transcription/wordSegmentMapper.js';
import { getEmbeddingModelConfig, DEFAULT_EMBEDDING_MODEL } from './config/models.js';
import { getSegmentationModelConfig, DEFAULT_SEGMENTATION_MODEL } from './config/segmentation.js';

// Configure ONNX Runtime globally to limit threads
// This reduces idle CPU usage and Safari energy warnings
ort.env.wasm.numThreads = 2;

// Configure Transformers.js to use our ONNX settings
// Transformers.js uses onnxruntime-web internally
transformersEnv.backends.onnx.wasm.numThreads = 2;

// Model identifiers
const ASR_MODEL_ID = 'Xenova/whisper-tiny.en';

// Singleton model manager
class ModelManager {
  static transcriber = null;
  static embeddingBackend = null;
  static embeddingModelConfig = null;
  static isLoaded = false;
  static device = 'wasm';
  // Cache for multiple embedding backends (for visualization)
  static embeddingBackendCache = new Map();

  /**
   * Load all models
   * @param {string} device - Device to use for ASR ('webgpu' or 'wasm')
   * @param {import('./config/models.js').EmbeddingModelConfig} [embeddingModelConfig] - Embedding model config
   * @param {function} progressCallback - Progress callback
   */
  static async load(device, embeddingModelConfig, progressCallback) {
    if (this.isLoaded) return;

    this.device = device;

    // Use provided config or fall back to default
    this.embeddingModelConfig = embeddingModelConfig || getEmbeddingModelConfig(DEFAULT_EMBEDDING_MODEL);

    // Configure device-specific settings for ASR
    const asrConfig = {
      progress_callback: progressCallback,
    };

    // Use WebGPU if available, otherwise WASM
    if (device === 'webgpu') {
      asrConfig.device = 'webgpu';
      asrConfig.dtype = {
        encoder_model: 'fp32',
        decoder_model_merged: 'q4', // 4-bit quantized decoder
      };
    } else {
      asrConfig.device = 'wasm';
      asrConfig.dtype = 'q8'; // 8-bit quantized for WASM
    }

    // Load Whisper ASR pipeline
    self.postMessage({
      type: 'loading-stage',
      stage: 'Loading Whisper ASR model...',
    });

    this.transcriber = await pipeline(
      'automatic-speech-recognition',
      ASR_MODEL_ID,
      asrConfig
    );

    // Load speaker embedding model using appropriate backend
    self.postMessage({
      type: 'loading-stage',
      stage: `Loading speaker embedding model (${this.embeddingModelConfig.name})...`,
    });

    // Select backend based on model configuration
    if (this.embeddingModelConfig.backend === 'onnx') {
      this.embeddingBackend = new OnnxBackend();
    } else {
      this.embeddingBackend = new TransformersBackend();
    }

    await this.embeddingBackend.load(this.embeddingModelConfig, progressCallback);

    // Cache the primary backend
    this.embeddingBackendCache.set(this.embeddingModelConfig.id, this.embeddingBackend);

    this.isLoaded = true;

    console.log(`[ModelManager] Loaded embedding model: ${this.embeddingModelConfig.name} (${this.embeddingModelConfig.backend})`);
  }

  /**
   * Run transcription on audio
   */
  static async runTranscription(audio) {
    // Note: Don't pass 'language' for English-only models like whisper-tiny.en
    return await this.transcriber(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
    });
  }

  /**
   * Peak normalize audio to handle gain/distance variation
   * Scales audio so the peak amplitude is 0.95
   * @param {Float32Array} samples - Raw audio samples
   * @returns {Float32Array} Normalized audio samples
   */
  static normalizeAudio(samples) {
    let maxAbs = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    // Avoid amplifying near-silence
    if (maxAbs > 0.001) {
      const scale = 0.95 / maxAbs;
      const normalized = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        normalized[i] = samples[i] * scale;
      }
      return normalized;
    }
    return samples;
  }

  /**
   * Extract speaker embedding from audio segment using configured backend
   * @param {Float32Array} audioSegment - Audio data for one speaker segment
   * @returns {Float32Array} Speaker embedding vector (dimensions depend on model)
   */
  static async extractEmbedding(audioSegment) {
    if (!this.embeddingBackend || !this.embeddingBackend.isReady()) {
      console.error('[ModelManager] Embedding backend not loaded');
      return null;
    }

    try {
      // Normalize audio to handle gain/distance variation
      const normalizedAudio = this.normalizeAudio(audioSegment);
      return await this.embeddingBackend.extractEmbedding(normalizedAudio);
    } catch (error) {
      console.error('[ModelManager] Embedding extraction error:', error);
      return null;
    }
  }

  /**
   * Get info about the loaded embedding model
   * @returns {import('./worker/backends/embeddingBackend.js').ModelInfo|null}
   */
  static getEmbeddingModelInfo() {
    return this.embeddingBackend?.getModelInfo() || null;
  }

  /**
   * Extract speaker embeddings for multiple audio segments (batch)
   * @param {Array<Float32Array>} audioSegments - Array of audio segments
   * @returns {Array<Float32Array>} Array of embeddings
   */
  static async extractEmbeddingsBatch(audioSegments) {
    const embeddings = [];
    for (const segment of audioSegments) {
      if (segment && segment.length >= 8000) { // Min 0.5s at 16kHz
        const emb = await this.extractEmbedding(segment);
        embeddings.push(emb);
      } else {
        embeddings.push(null);
      }
    }
    return embeddings;
  }

  /**
   * Get or load an embedding backend for a specific model
   * Used for visualization with different models
   * @param {string} modelId - Model ID to get/load
   * @returns {Promise<import('./worker/backends/embeddingBackend.js').EmbeddingBackend>}
   */
  static async getOrLoadBackend(modelId) {
    // Check cache first
    if (this.embeddingBackendCache.has(modelId)) {
      return this.embeddingBackendCache.get(modelId);
    }

    // Load the model
    const modelConfig = getEmbeddingModelConfig(modelId);
    if (!modelConfig) {
      throw new Error(`Unknown embedding model: ${modelId}`);
    }

    console.log(`[ModelManager] Loading embedding model for visualization: ${modelConfig.name}`);

    let backend;
    if (modelConfig.backend === 'onnx') {
      backend = new OnnxBackend();
    } else {
      backend = new TransformersBackend();
    }

    // Load without progress callback (visualization is background operation)
    await backend.load(modelConfig, () => {});

    // Cache the backend
    this.embeddingBackendCache.set(modelId, backend);

    console.log(`[ModelManager] Cached embedding backend: ${modelConfig.name}`);
    return backend;
  }

  /**
   * Extract embedding using a specific model (for visualization)
   * @param {Float32Array} audioSegment - Audio data
   * @param {string} modelId - Model ID to use
   * @returns {Promise<Float32Array|null>}
   */
  static async extractEmbeddingWithModel(audioSegment, modelId) {
    try {
      const backend = await this.getOrLoadBackend(modelId);
      if (!backend || !backend.isReady()) {
        console.error(`[ModelManager] Backend not ready for model: ${modelId}`);
        return null;
      }

      const normalizedAudio = this.normalizeAudio(audioSegment);
      return await backend.extractEmbedding(normalizedAudio);
    } catch (error) {
      console.error(`[ModelManager] Embedding extraction error for ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Clear visualization backends that are not the primary embedding backend.
   * This releases ONNX sessions and reduces idle CPU/memory usage.
   * Should be called when the speakers modal closes.
   * @returns {Promise<number>} Number of backends cleared
   */
  static async clearVisualizationBackends() {
    const primaryModelId = this.embeddingModelConfig?.id;
    let clearedCount = 0;

    for (const [modelId, backend] of this.embeddingBackendCache.entries()) {
      // Don't dispose the primary embedding backend used for transcription
      if (modelId === primaryModelId) {
        continue;
      }

      try {
        console.log(`[ModelManager] Disposing visualization backend: ${modelId}`);
        await backend.dispose();
        this.embeddingBackendCache.delete(modelId);
        clearedCount++;
      } catch (error) {
        console.error(`[ModelManager] Error disposing backend ${modelId}:`, error);
      }
    }

    if (clearedCount > 0) {
      console.log(`[ModelManager] Cleared ${clearedCount} visualization backend(s)`);
    }

    return clearedCount;
  }
}

// Singleton segmentation manager
class SegmentationManager {
  static backend = null;
  static modelConfig = null;
  static isLoaded = false;

  /**
   * Load segmentation model
   * @param {import('./config/segmentation.js').SegmentationModelConfig} [segModelConfig]
   * @param {function} progressCallback
   * @param {Record<string, number>} [initialParams] - Initial parameter values
   */
  static async load(segModelConfig, progressCallback, initialParams = {}) {
    // Use provided config or fall back to default
    this.modelConfig = segModelConfig || getSegmentationModelConfig(DEFAULT_SEGMENTATION_MODEL);

    console.log(`[SegmentationManager] Loading ${this.modelConfig.name} (${this.modelConfig.backend})`);

    // Select backend based on config
    switch (this.modelConfig.backend) {
      case 'text-gap':
        this.backend = new PhraseGapBackend();
        break;
      case 'transformers-js':
        this.backend = new PyannoteSegBackend();
        break;
      case 'onnx':
        this.backend = new OnnxSegBackend();
        break;
      default:
        throw new Error(`Unknown segmentation backend: ${this.modelConfig.backend}`);
    }

    await this.backend.load(this.modelConfig, progressCallback, initialParams);
    this.isLoaded = true;

    console.log(`[SegmentationManager] Loaded ${this.modelConfig.name}`);
  }

  /**
   * Segment audio into speaker turns
   * @param {Float32Array} audio - Audio at 16kHz
   * @param {Object} options
   * @param {Array} [options.words] - Whisper words (for text-gap backend)
   * @returns {Promise<import('./worker/backends/segmentation/segmentationBackend.js').SegmentationResult>}
   */
  static async segment(audio, options = {}) {
    if (!this.isReady()) {
      throw new Error('[SegmentationManager] Segmentation model not loaded');
    }
    return this.backend.segment(audio, options);
  }

  /**
   * Check if segmentation is ready
   * @returns {boolean}
   */
  static isReady() {
    return this.isLoaded && this.backend?.isReady();
  }

  /**
   * Get info about the loaded segmentation model
   * @returns {import('./worker/backends/segmentation/segmentationBackend.js').SegmentationModelInfo|null}
   */
  static getModelInfo() {
    return this.backend?.getModelInfo() || null;
  }

  /**
   * Get current segmentation parameters
   * @returns {Record<string, number>}
   */
  static getParams() {
    return this.backend?.getParams() || {};
  }

  /**
   * Set segmentation parameters (merges with existing)
   * @param {Record<string, number>} params
   */
  static setParams(params) {
    if (!this.backend) return;
    this.backend.setParams(params);
  }
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
  const { type, requestId, ...payload } = event.data;
  // Support both old API (data property) and new API (flat payload)
  const data = payload.data || payload;

  switch (type) {
    case 'load':
      await handleLoad(data, requestId);
      break;
    case 'transcribe':
      await handleTranscribe(data, requestId);
      break;
    case 'extract-embedding':
      await handleExtractEmbedding(data, requestId);
      break;
    case 'batch-extract-embeddings':
      await handleBatchExtractEmbeddings(data, requestId);
      break;
    case 'transcribe-for-validation':
      await handleTranscribeForValidation(data, requestId);
      break;
    case 'check-webgpu':
      await checkWebGPU(requestId);
      break;
    case 'set-segmentation-params':
      handleSetSegmentationParams(data, requestId);
      break;
    case 'clear-visualization-backends':
      await handleClearVisualizationBackends(requestId);
      break;
  }
});

/**
 * Handle real-time segmentation parameter updates
 */
function handleSetSegmentationParams(data, requestId) {
  const { params } = data;
  if (!SegmentationManager.isReady()) {
    console.warn('[Worker] Cannot update params: segmentation model not loaded');
    self.postMessage({
      type: 'set-segmentation-params',
      requestId,
      success: false,
      error: 'Segmentation model not loaded',
    });
    return;
  }

  SegmentationManager.setParams(params);
  console.log('[Worker] Updated segmentation params:', params);

  self.postMessage({
    type: 'set-segmentation-params',
    requestId,
    success: true,
    params: SegmentationManager.getParams(),
  });
}

/**
 * Handle clearing visualization backends
 * Releases ONNX sessions loaded for visualization to reduce idle resource usage
 */
async function handleClearVisualizationBackends(requestId) {
  try {
    const clearedCount = await ModelManager.clearVisualizationBackends();
    self.postMessage({
      type: 'clear-visualization-backends',
      requestId,
      success: true,
      clearedCount,
    });
  } catch (error) {
    console.error('[Worker] Error clearing visualization backends:', error);
    self.postMessage({
      type: 'clear-visualization-backends',
      requestId,
      success: false,
      error: error.message,
    });
  }
}

/**
 * Check WebGPU availability
 */
async function checkWebGPU(requestId) {
  let hasWebGPU = false;

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      hasWebGPU = !!adapter;
    } catch (e) {
      hasWebGPU = false;
    }
  }

  self.postMessage({
    type: 'webgpu-check',
    requestId,
    available: hasWebGPU,
    device: hasWebGPU ? 'webgpu' : 'wasm',
  });
}

/**
 * Load models
 * @param {Object} params
 * @param {string} params.device - Device to use ('webgpu' or 'wasm')
 * @param {import('./config/models.js').EmbeddingModelConfig} [params.embeddingModel] - Embedding model config
 * @param {import('./config/segmentation.js').SegmentationModelConfig} [params.segmentationModel] - Segmentation model config
 * @param {Record<string, number>} [params.segmentationParams] - Initial segmentation parameter values
 * @param {string} requestId
 */
async function handleLoad({ device, embeddingModel, segmentationModel, segmentationParams }, requestId) {
  try {
    const modelName = embeddingModel?.name || 'default';
    self.postMessage({
      type: 'status',
      status: 'loading',
      message: `Loading models using ${device.toUpperCase()}...`,
    });

    const progressCallback = (progress) => {
      // Forward progress to main thread
      // Include 'ready' status which Transformers.js sends for cached files
      if (progress.status === 'progress' || progress.status === 'initiate' || progress.status === 'done' || progress.status === 'ready') {
        self.postMessage({ type: 'progress', ...progress });
      }
    };

    await ModelManager.load(device, embeddingModel, progressCallback);

    // Load segmentation model
    const segModelName = segmentationModel?.name || 'default';
    self.postMessage({
      type: 'loading-stage',
      stage: `Loading segmentation model (${segModelName})...`,
    });

    await SegmentationManager.load(segmentationModel, progressCallback, segmentationParams || {});

    // Warmup for WebGPU (compile shaders)
    if (device === 'webgpu') {
      self.postMessage({
        type: 'status',
        status: 'loading',
        message: 'Compiling shaders (first-time warmup)...',
      });

      // Run a tiny inference to trigger shader compilation
      // Note: Don't pass 'language' for English-only models like whisper-tiny.en
      const warmupAudio = new Float32Array(16000); // 1 second of silence
      await ModelManager.transcriber(warmupAudio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
      });
    }

    const embeddingModelInfo = ModelManager.getEmbeddingModelInfo();
    const segmentationModelInfo = SegmentationManager.getModelInfo();
    self.postMessage({
      type: 'status',
      status: 'ready',
      message: 'Models loaded and ready!',
      embeddingModel: embeddingModelInfo,
      segmentationModel: segmentationModelInfo,
    });

    // Send completion signal for promise-based API
    if (requestId) {
      self.postMessage({
        type: 'load-complete',
        requestId,
        embeddingModel: embeddingModelInfo,
        segmentationModel: segmentationModelInfo,
      });
    }
  } catch (error) {
    console.error('Model loading error:', error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: `Failed to load models: ${error.message}`,
    });
    if (requestId) {
      self.postMessage({
        type: 'error',
        requestId,
        message: error.message,
      });
    }
  }
}

/**
 * Join adjacent words that form bracketed markers (e.g., "[BLANK" + "_AUDIO]" → "[BLANK_AUDIO]")
 * Whisper sometimes splits bracketed markers across multiple word tokens
 * Note: Whisper words often have leading whitespace, so we trim when checking patterns
 * @param {Array} words - Array of word objects with text and timestamp
 * @returns {Array} Words with split markers joined
 */
function joinSplitBracketedMarkers(words) {
  if (!words || words.length < 2) return words;

  const result = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const text = word.text || '';
    const trimmedText = text.trim();

    // Check if this word starts a bracketed marker (starts with "[" but doesn't end with "]")
    if (trimmedText.startsWith('[') && !trimmedText.endsWith(']')) {
      // Look ahead to find the closing bracket
      let combined = text;
      let endTimestamp = word.timestamp?.[1];
      let j = i + 1;
      let foundClosing = false;

      while (j < words.length) {
        const nextWord = words[j];
        const nextText = nextWord.text || '';
        const nextTrimmed = nextText.trim();
        combined += nextText;
        endTimestamp = nextWord.timestamp?.[1];

        if (nextTrimmed.endsWith(']')) {
          // Found the closing bracket - create combined word
          result.push({
            text: combined,
            timestamp: [word.timestamp?.[0], endTimestamp],
          });
          i = j + 1;
          foundClosing = true;
          break;
        }
        j++;
      }

      // If we didn't find closing bracket, just add the original word
      if (!foundClosing) {
        result.push(word);
        i++;
      }
    } else {
      result.push(word);
      i++;
    }
  }

  return result;
}

/**
 * Check if a word is a blank audio marker
 * Handles various formats: [BLANK_AUDIO], [BLANK AUDIO], [BLANK _AUDIO], etc.
 * @param {Object} word - Word object with text property
 * @returns {boolean}
 */
function isBlankAudioMarker(word) {
  const text = (word.text || '').trim().toUpperCase();
  // Normalize by removing extra spaces and underscores, then check
  const normalized = text.replace(/[\s_]+/g, '');
  return normalized === '[BLANKAUDIO]';
}

/**
 * Transcribe audio chunk using phrase-based diarization
 * Flow: ASR → Detect phrases from word gaps → Extract audio per phrase → SV embedding per phrase
 *
 * With VAD + overlap merging:
 * - Chunks are VAD-triggered (variable duration, 1-15s)
 * - Overlap audio is prepended by AudioCapture
 * - ALL words are kept (no discard) - overlap merging happens in app.js
 */
async function handleTranscribe({ audio, language = 'en', chunkIndex, overlapDuration = 0, isFinal = false, channelId = 0, skipEmbedding = false }, requestId) {
  try {
    const startTime = performance.now();

    // Convert audio array back to Float32Array if needed
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);
    const sampleRate = 16000;
    const audioDuration = audioData.length / sampleRate;

    // 1. Run ASR to get transcript with word-level timestamps
    const asrStartTime = performance.now();
    const asrResult = await ModelManager.runTranscription(audioData);
    const asrTime = performance.now() - asrStartTime;

    // Join split bracketed markers (e.g., "[BLANK" + "_AUDIO]" → "[BLANK_AUDIO]")
    const rawWords = asrResult.chunks || [];
    const words = joinSplitBracketedMarkers(rawWords);

    // Debug: Log raw Whisper output
    self.postMessage({
      type: 'debug-log',
      logType: 'whisper',
      data: {
        chunkIndex,
        text: asrResult.text,
        wordCount: words.length,
        asrTimeMs: Math.round(asrTime),
        words: words.map(w => ({
          text: w.text,
          timestamp: w.timestamp,
        })),
      },
    });

    // 2. Keep ALL words - overlap merging handled by app.js
    // No more last-word-discard or splitPoint calculation
    const wordsToKeep = words;

    // 3. Segment audio using configured backend (text-gap or acoustic)
    const segStartTime = performance.now();
    const segResult = await SegmentationManager.segment(audioData, { words: wordsToKeep });
    const segTime = performance.now() - segStartTime;

    // 4. Get phrases - either directly from text-gap or by mapping words to acoustic segments
    let phrases;
    if (segResult.method === 'acoustic') {
      // Map Whisper words to acoustic segment boundaries
      phrases = mapWordsToSegments(wordsToKeep, segResult.segments);
    } else {
      // Text-gap already returns phrases with words attached
      phrases = segResult.segments;
    }

    // Debug: Log segmentation results
    self.postMessage({
      type: 'debug-log',
      logType: 'segmentation',
      data: {
        chunkIndex,
        method: segResult.method,
        segmentCount: segResult.segments?.length || 0,
        phraseCount: phrases.length,
        segTimeMs: Math.round(segTime),
        // For acoustic, show raw segments
        ...(segResult.method === 'acoustic' && {
          acousticSegments: segResult.segments.map(s => ({
            speakerId: s.speakerId,
            start: s.start,
            end: s.end,
            confidence: s.confidence?.toFixed(2),
          })),
        }),
        phrases: phrases.map(p => ({
          text: p.words?.map(w => w.text).join('') || '',
          start: p.start,
          end: p.end,
          duration: p.end - p.start,
          wordCount: p.words?.length || 0,
          acousticSpeakerId: p.acousticSpeakerId,
        })),
      },
    });

    // 5. Extract audio segments for each phrase and get SV embeddings
    // Skip embedding extraction if skipEmbedding=true (single-speaker channel optimization)
    const embeddingStartTime = performance.now();
    const phrasesWithEmbeddings = [];

    for (const phrase of phrases) {
      const duration = phrase.end - phrase.start;

      // Extract audio segment for this phrase
      const startSample = Math.floor(phrase.start * sampleRate);
      const endSample = Math.min(Math.ceil(phrase.end * sampleRate), audioData.length);
      const phraseAudio = audioData.slice(startSample, endSample);

      // Only get embedding if phrase is long enough (0.5s = 8000 samples)
      // and skipEmbedding is not set (single-speaker channels skip this)
      let embedding = null;
      let frameCount = phraseAudio.length;
      let reason = null;

      if (skipEmbedding) {
        reason = 'skipped_single_speaker';
      } else if (duration >= 0.5 && phraseAudio.length >= 8000) {
        embedding = await ModelManager.extractEmbedding(phraseAudio);
        reason = embedding ? null : 'extraction_failed';
      } else {
        reason = 'too_short';
      }

      phrasesWithEmbeddings.push({
        ...phrase,
        embedding,
        frameCount,
        channelId, // Include channel info on each phrase
        reason,
      });
    }

    const embeddingTime = performance.now() - embeddingStartTime;
    const processingTime = performance.now() - startTime;

    // Debug: Log embedding extraction results
    self.postMessage({
      type: 'debug-log',
      logType: 'embeddings',
      data: {
        chunkIndex,
        embeddingTimeMs: Math.round(embeddingTime),
        results: phrasesWithEmbeddings.map((p, i) => ({
          phraseIndex: i,
          text: p.words.map(w => w.text).join('').substring(0, 50),
          duration: p.end - p.start,
          frameCount: p.frameCount,
          hasEmbedding: !!p.embedding,
          reason: p.reason || 'success',
        })),
      },
    });

    // Check if the result is effectively empty (only blank audio markers)
    const nonBlankWords = wordsToKeep.filter(w => !isBlankAudioMarker(w));
    const isEffectivelyEmpty = wordsToKeep.length > 0 && nonBlankWords.length === 0;

    self.postMessage({
      type: 'result',
      requestId,
      text: wordsToKeep.map(w => w.text).join(''),
      words: wordsToKeep,
      language: asrResult.language || 'en',
      // Full data for backward compatibility
      data: {
        transcript: {
          ...asrResult,
          // All words are kept now
          chunks: wordsToKeep,
          text: wordsToKeep.map(w => w.text).join(''),
        },
        // Raw ASR output for debugging display
        rawAsr: {
          allWords: words, // All words from Whisper
          keptWords: wordsToKeep, // Same as allWords now (no discard)
          audioDuration: audioDuration,
        },
        phrases: phrasesWithEmbeddings,
        chunkIndex,
        channelId, // Include channel for dual-input support
        processingTime,
        overlapDuration, // Echo back for app.js merge logic
        isFinal,
        isEffectivelyEmpty,
        // Debug timing breakdown
        debug: {
          asrTime: Math.round(asrTime),
          segTime: Math.round(segTime),
          segMethod: segResult.method,
          embeddingTime: Math.round(embeddingTime),
          skippedEmbedding: skipEmbedding, // Track if we skipped embedding for this chunk
        },
      },
    });
  } catch (error) {
    console.error('Transcription error:', error);
    self.postMessage({
      type: 'error',
      requestId,
      message: `Transcription failed: ${error.message}`,
      chunkIndex,
    });
  }
}

/**
 * Extract embedding for enrollment
 */
async function handleExtractEmbedding({ audio, sampleId, modelId }, requestId) {
  try {
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);

    // Minimum 0.5s of audio required (8000 samples at 16kHz)
    if (audioData.length < 8000) {
      throw new Error('Audio too short (minimum 0.5 seconds)');
    }

    // Use specific model if requested (for visualization), otherwise use default
    let embedding;
    if (modelId) {
      embedding = await ModelManager.extractEmbeddingWithModel(audioData, modelId);
    } else {
      embedding = await ModelManager.extractEmbedding(audioData);
    }

    if (!embedding) {
      throw new Error('Failed to extract embedding');
    }

    self.postMessage({
      type: 'embedding-result',
      requestId,
      embedding: Array.from(embedding),
      // Backward compatibility
      data: {
        sampleId,
        embedding: Array.from(embedding),
        success: true,
      },
    });
  } catch (error) {
    console.error('Embedding extraction error:', error);
    self.postMessage({
      type: 'error',
      requestId,
      message: error.message,
      // Backward compatibility
      data: {
        sampleId,
        success: false,
        error: error.message,
      },
    });
  }
}

/**
 * Extract embeddings for multiple audio segments in batch
 * Used for reprocessing recordings with a different embedding model
 */
async function handleBatchExtractEmbeddings({ segments }, requestId) {
  const results = [];
  const total = segments.length;

  for (let i = 0; i < total; i++) {
    const seg = segments[i];
    try {
      const audioData = seg.audio instanceof Float32Array ? seg.audio : new Float32Array(seg.audio);

      // Minimum 0.5s of audio required (8000 samples at 16kHz)
      if (audioData.length < 8000) {
        results.push({ index: seg.index, embedding: null, error: 'Audio too short' });
      } else {
        const embedding = await ModelManager.extractEmbedding(audioData);
        results.push({
          index: seg.index,
          embedding: embedding ? Array.from(embedding) : null,
          error: embedding ? null : 'Extraction failed',
        });
      }

      // Emit progress
      self.postMessage({
        type: 'batch-embedding-progress',
        requestId,
        current: i + 1,
        total,
      });
    } catch (error) {
      results.push({ index: seg.index, embedding: null, error: error.message });
    }
  }

  self.postMessage({
    type: 'batch-embedding-result',
    requestId,
    results,
  });
}

/**
 * Transcribe audio for enrollment validation
 * Returns just the text for comparison against expected sentence
 */
async function handleTranscribeForValidation({ audio, sampleId }, requestId) {
  try {
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);

    // Run transcription
    const result = await ModelManager.runTranscription(audioData);
    const text = result.text || '';
    const words = result.chunks || [];

    self.postMessage({
      type: 'transcription-validation-result',
      requestId,
      text,
      words,
      // Backward compatibility
      data: {
        sampleId,
        text,
        success: true,
      },
    });
  } catch (error) {
    console.error('Transcription validation error:', error);
    self.postMessage({
      type: 'error',
      requestId,
      message: error.message,
      // Backward compatibility
      data: {
        sampleId,
        success: false,
        error: error.message,
      },
    });
  }
}
