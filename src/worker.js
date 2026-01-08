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
// Using base model (not -sv) to access frame-level features via last_hidden_state
const EMBEDDING_MODEL_ID = 'Xenova/wavlm-base-plus';

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
   * Extract speaker embedding from audio segment using mean pooling of frame features
   * @param {Float32Array} audioSegment - Audio data for one speaker segment
   * @returns {Float32Array} 768-dimensional embedding vector (mean-pooled from frames)
   */
  static async extractEmbedding(audioSegment) {
    try {
      const inputs = await this.embeddingProcessor(audioSegment);
      const output = await this.embeddingModel(inputs);

      // Base WavLM model outputs last_hidden_state with shape [1, frames, 768]
      const hiddenState = output.last_hidden_state;
      if (!hiddenState) {
        console.error('No last_hidden_state in model output. Keys:', Object.keys(output));
        return null;
      }

      // Mean pool across frames to get single embedding
      const [batchSize, numFrames, hiddenDim] = hiddenState.dims;
      const data = hiddenState.data;
      const embedding = new Float32Array(hiddenDim);

      for (let f = 0; f < numFrames; f++) {
        const frameOffset = f * hiddenDim;
        for (let d = 0; d < hiddenDim; d++) {
          embedding[d] += data[frameOffset + d];
        }
      }

      // Divide by number of frames for mean
      for (let d = 0; d < hiddenDim; d++) {
        embedding[d] /= numFrames;
      }

      return embedding;
    } catch (error) {
      console.error('Embedding extraction error:', error);
      return null;
    }
  }

  /**
   * Extract frame-level features from audio (for phrase-level diarization)
   * @param {Float32Array} audio - Full audio data
   * @returns {Object} Object with dims and data for frame features
   */
  static async extractFrameFeatures(audio) {
    try {
      const inputs = await this.embeddingProcessor(audio);
      const output = await this.embeddingModel(inputs);
      return output.last_hidden_state;
    } catch (error) {
      console.error('Frame feature extraction error:', error);
      return null;
    }
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
 * Flow: ASR → Detect phrases from word gaps → Extract frame features → Embed per phrase
 */
async function handleTranscribe({ audio, language = 'en', chunkIndex, carryoverDuration = 0, isFinal = false }) {
  try {
    const startTime = performance.now();

    // Convert audio array back to Float32Array if needed
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);
    const sampleRate = 16000;
    const audioDuration = audioData.length / sampleRate;

    // 1. Run ASR to get transcript with word-level timestamps
    const asrResult = await ModelManager.runTranscription(audioData);

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

    // 4. Extract frame-level features (single WavLM call for entire chunk)
    const frameFeatures = await ModelManager.extractFrameFeatures(audioData);

    // 5. Extract per-phrase embeddings by slicing frame features
    const phrasesWithEmbeddings = phraseDetector.extractPhraseEmbeddings(
      frameFeatures,
      phrases,
      audioDuration
    );

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
