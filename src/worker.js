/**
 * Web Worker for ASR and Speaker Diarization
 * Runs Whisper and WavLM models in a separate thread to keep UI responsive.
 * Uses phrase-based diarization: Whisper word timestamps + WavLM frame features.
 */

import {
  pipeline,
  AutoProcessor,
  AutoModel,
} from '@huggingface/transformers';

import { PhraseDetector } from './core/transcription/phraseDetector.js';

// Model identifiers
const ASR_MODEL_ID = 'Xenova/whisper-tiny.en';
// Speaker verification model - trained to distinguish speakers (outputs embeddings directly)
const EMBEDDING_MODEL_ID = 'Xenova/wavlm-base-plus-sv';

// Phrase detector instance
const phraseDetector = new PhraseDetector({
  gapThreshold: 0.300,    // 300ms gap triggers phrase boundary
  minPhraseDuration: 0.5, // 500ms minimum for reliable embedding
});

// Singleton model manager
class ModelManager {
  static transcriber = null;
  static embeddingProcessor = null;
  static embeddingModel = null;
  static isLoaded = false;
  static device = 'wasm';

  /**
   * Load all models
   */
  static async load(device, progressCallback) {
    if (this.isLoaded) return;

    this.device = device;

    // Configure device-specific settings
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

    // Load WavLM speaker embedding model (for frame-level features)
    self.postMessage({
      type: 'loading-stage',
      stage: 'Loading speaker embedding model...',
    });

    this.embeddingProcessor = await AutoProcessor.from_pretrained(
      EMBEDDING_MODEL_ID,
      { progress_callback: progressCallback }
    );

    this.embeddingModel = await AutoModel.from_pretrained(
      EMBEDDING_MODEL_ID,
      {
        device: 'wasm',
        dtype: 'fp32', // fp32 for accurate frame-level features
        progress_callback: progressCallback,
      }
    );

    this.isLoaded = true;
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
   * Extract speaker embedding from audio segment using SV model
   * @param {Float32Array} audioSegment - Audio data for one speaker segment
   * @returns {Float32Array} Speaker embedding vector (512-dimensional for SV model)
   */
  static async extractEmbedding(audioSegment) {
    try {
      // Normalize audio to handle gain/distance variation
      const normalizedAudio = this.normalizeAudio(audioSegment);
      const inputs = await this.embeddingProcessor(normalizedAudio);
      const output = await this.embeddingModel(inputs);

      // SV model outputs embeddings directly with shape [1, embedding_dim]
      const embeddings = output.embeddings;
      if (!embeddings) {
        console.error('No embeddings in model output. Keys:', Object.keys(output));
        return null;
      }

      // Diagnostic: Log raw embedding stats before any normalization
      const raw = embeddings.data;
      let norm = 0, min = Infinity, max = -Infinity, sum = 0;
      for (let i = 0; i < raw.length; i++) {
        norm += raw[i] * raw[i];
        sum += raw[i];
        if (raw[i] < min) min = raw[i];
        if (raw[i] > max) max = raw[i];
      }
      console.log(`[WavLM Raw] dim=${raw.length}, norm=${Math.sqrt(norm).toFixed(4)}, mean=${(sum/raw.length).toFixed(6)}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`);

      // Return as Float32Array
      return new Float32Array(embeddings.data);
    } catch (error) {
      console.error('Embedding extraction error:', error);
      return null;
    }
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
    case 'transcribe-for-validation':
      await handleTranscribeForValidation(data, requestId);
      break;
    case 'check-webgpu':
      await checkWebGPU(requestId);
      break;
  }
});

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
 */
async function handleLoad({ device }, requestId) {
  try {
    self.postMessage({
      type: 'status',
      status: 'loading',
      message: `Loading models using ${device.toUpperCase()}...`,
    });

    await ModelManager.load(device, (progress) => {
      // Forward progress to main thread
      if (progress.status === 'progress' || progress.status === 'initiate' || progress.status === 'done') {
        self.postMessage({ type: 'progress', ...progress });
      }
    });

    // Warmup for WebGPU (compile shaders)
    if (device === 'webgpu') {
      self.postMessage({
        type: 'status',
        status: 'loading',
        message: 'Compiling shaders (first-time warmup)...',
      });

      // Run a tiny inference to trigger shader compilation
      const warmupAudio = new Float32Array(16000); // 1 second of silence
      await ModelManager.transcriber(warmupAudio, { language: 'en' });
    }

    self.postMessage({
      type: 'status',
      status: 'ready',
      message: 'Models loaded and ready!',
    });

    // Send completion signal for promise-based API
    if (requestId) {
      self.postMessage({
        type: 'load-complete',
        requestId,
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
async function handleTranscribe({ audio, language = 'en', chunkIndex, overlapDuration = 0, isFinal = false }, requestId) {
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

    // 3. Detect phrase boundaries from all words
    const phrases = phraseDetector.detectPhrases(wordsToKeep);

    // Debug: Log phrase detection results
    self.postMessage({
      type: 'debug-log',
      logType: 'phrases',
      data: {
        chunkIndex,
        phraseCount: phrases.length,
        phrases: phrases.map(p => ({
          text: p.words.map(w => w.text).join(''),
          start: p.start,
          end: p.end,
          duration: p.end - p.start,
          wordCount: p.words.length,
        })),
      },
    });

    // 4. Extract audio segments for each phrase and get SV embeddings
    const embeddingStartTime = performance.now();
    const phrasesWithEmbeddings = [];

    for (const phrase of phrases) {
      const duration = phrase.end - phrase.start;

      // Extract audio segment for this phrase
      const startSample = Math.floor(phrase.start * sampleRate);
      const endSample = Math.min(Math.ceil(phrase.end * sampleRate), audioData.length);
      const phraseAudio = audioData.slice(startSample, endSample);

      // Only get embedding if phrase is long enough (0.5s = 8000 samples)
      let embedding = null;
      let frameCount = phraseAudio.length;

      if (duration >= 0.5 && phraseAudio.length >= 8000) {
        embedding = await ModelManager.extractEmbedding(phraseAudio);
      }

      phrasesWithEmbeddings.push({
        ...phrase,
        embedding,
        frameCount,
        reason: embedding ? null : (duration < 0.5 ? 'too_short' : 'extraction_failed'),
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
        processingTime,
        overlapDuration, // Echo back for app.js merge logic
        isFinal,
        isEffectivelyEmpty,
        // Debug timing breakdown
        debug: {
          asrTime: Math.round(asrTime),
          featureTime: 0,
          embeddingTime: Math.round(embeddingTime),
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
async function handleExtractEmbedding({ audio, sampleId }, requestId) {
  try {
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);

    // Minimum 0.5s of audio required (8000 samples at 16kHz)
    if (audioData.length < 8000) {
      throw new Error('Audio too short (minimum 0.5 seconds)');
    }

    const embedding = await ModelManager.extractEmbedding(audioData);

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
