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

import { PhraseDetector } from './utils/phraseDetector.js';

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
   * Extract speaker embedding from audio segment using SV model
   * @param {Float32Array} audioSegment - Audio data for one speaker segment
   * @returns {Float32Array} Speaker embedding vector (512-dimensional for SV model)
   */
  static async extractEmbedding(audioSegment) {
    try {
      const inputs = await this.embeddingProcessor(audioSegment);
      const output = await this.embeddingModel(inputs);

      // SV model outputs embeddings directly with shape [1, embedding_dim]
      const embeddings = output.embeddings;
      if (!embeddings) {
        console.error('No embeddings in model output. Keys:', Object.keys(output));
        return null;
      }

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
  const { type, data } = event.data;

  switch (type) {
    case 'load':
      await handleLoad(data);
      break;
    case 'transcribe':
      await handleTranscribe(data);
      break;
    case 'extract-embedding':
      await handleExtractEmbedding(data);
      break;
    case 'check-webgpu':
      await checkWebGPU();
      break;
  }
});

/**
 * Check WebGPU availability
 */
async function checkWebGPU() {
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
    hasWebGPU,
    device: hasWebGPU ? 'webgpu' : 'wasm',
  });
}

/**
 * Load models
 */
async function handleLoad({ device }) {
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
  } catch (error) {
    console.error('Model loading error:', error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: `Failed to load models: ${error.message}`,
    });
  }
}

/**
 * Transcribe audio chunk using phrase-based diarization
 * Flow: ASR → Detect phrases from word gaps → Extract audio per phrase → SV embedding per phrase
 */
async function handleTranscribe({ audio, language = 'en', chunkIndex, carryoverDuration = 0, isFinal = false }) {
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

    const words = asrResult.chunks || [];

    // 2. Calculate split point for carryover
    // Split point = end of second-to-last word (so last word gets re-transcribed next chunk)
    // For final chunk, keep ALL words (no next chunk to re-transcribe)
    // If < 2 words, carry over everything
    let splitPoint = 0; // seconds from start of this chunk's audio
    let wordsToKeep = [];

    if (isFinal) {
      // Final chunk - keep all words, no carryover needed
      wordsToKeep = words;
      splitPoint = audioDuration; // No carryover
    } else if (words.length >= 2) {
      // Keep all words except the last one
      wordsToKeep = words.slice(0, -1);
      const secondToLastWord = words[words.length - 2];
      splitPoint = secondToLastWord.timestamp?.[1] || 0;
    } else if (words.length === 1) {
      // Only one word - don't keep it, carry over entire chunk
      wordsToKeep = [];
      splitPoint = 0;
    } else {
      // No words - nothing to keep, carry over entire chunk
      wordsToKeep = [];
      splitPoint = 0;
    }

    // 3. Detect phrase boundaries from the words we're keeping
    const phrases = phraseDetector.detectPhrases(wordsToKeep);

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

    self.postMessage({
      type: 'result',
      data: {
        transcript: {
          ...asrResult,
          // Override chunks with only the words we're keeping
          chunks: wordsToKeep,
          // Reconstruct text from kept words
          text: wordsToKeep.map(w => w.text).join(''),
        },
        phrases: phrasesWithEmbeddings,
        chunkIndex,
        processingTime,
        splitPoint, // seconds - app.js uses this to calculate carryover audio
        carryoverDuration, // echo back so app.js can adjust timestamps
        // Debug timing breakdown
        debug: {
          asrTime: Math.round(asrTime),
          featureTime: 0, // No longer using frame features
          embeddingTime: Math.round(embeddingTime),
        },
      },
    });
  } catch (error) {
    console.error('Transcription error:', error);
    self.postMessage({
      type: 'error',
      message: `Transcription failed: ${error.message}`,
      chunkIndex,
    });
  }
}

/**
 * Extract embedding for enrollment
 */
async function handleExtractEmbedding({ audio, sampleId }) {
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
      data: {
        sampleId,
        embedding: Array.from(embedding),
        success: true,
      },
    });
  } catch (error) {
    console.error('Embedding extraction error:', error);
    self.postMessage({
      type: 'embedding-result',
      data: {
        sampleId,
        success: false,
        error: error.message,
      },
    });
  }
}
