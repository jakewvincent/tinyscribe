/**
 * Web Worker for ASR and Speaker Diarization
 * Runs Whisper and Pyannote models in a separate thread to keep UI responsive
 */

import {
  pipeline,
  AutoProcessor,
  AutoModelForAudioFrameClassification,
  AutoModel,
} from '@huggingface/transformers';

// Model identifiers
const ASR_MODEL_ID = 'Xenova/whisper-tiny.en';
const DIARIZATION_MODEL_ID = 'onnx-community/pyannote-segmentation-3.0';
const EMBEDDING_MODEL_ID = 'Xenova/wavlm-base-plus-sv';

// Singleton model manager
class ModelManager {
  static transcriber = null;
  static segmentationProcessor = null;
  static segmentationModel = null;
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

    // Load Pyannote segmentation processor
    self.postMessage({
      type: 'loading-stage',
      stage: 'Loading diarization processor...',
    });

    this.segmentationProcessor = await AutoProcessor.from_pretrained(
      DIARIZATION_MODEL_ID,
      { progress_callback: progressCallback }
    );

    // Load Pyannote segmentation model (always WASM - WebGPU not supported)
    self.postMessage({
      type: 'loading-stage',
      stage: 'Loading diarization model...',
    });

    this.segmentationModel = await AutoModelForAudioFrameClassification.from_pretrained(
      DIARIZATION_MODEL_ID,
      {
        device: 'wasm',
        dtype: 'fp32',
        progress_callback: progressCallback,
      }
    );

    // Load WavLM speaker embedding model
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
        dtype: 'q8',
        progress_callback: progressCallback,
      }
    );

    this.isLoaded = true;
  }

  /**
   * Run speaker segmentation on audio
   */
  static async runSegmentation(audio) {
    try {
      const inputs = await this.segmentationProcessor(audio);
      const { logits } = await this.segmentationModel(inputs);

      // Post-process to get speaker segments
      const segments = this.segmentationProcessor.post_process_speaker_diarization(
        logits,
        audio.length
      )[0];

      // Add human-readable labels
      for (const segment of segments) {
        segment.label =
          this.segmentationModel.config.id2label?.[segment.id] ||
          `SPEAKER_${segment.id}`;
      }

      return segments;
    } catch (error) {
      console.error('Segmentation error:', error);
      // Return empty segments on error - transcription will still work
      return [];
    }
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
   * Extract speaker embedding from audio segment
   * @param {Float32Array} audioSegment - Audio data for one speaker segment
   * @returns {Float32Array} 512-dimensional embedding vector
   */
  static async extractEmbedding(audioSegment) {
    try {
      const inputs = await this.embeddingProcessor(audioSegment);
      const output = await this.embeddingModel(inputs);
      // Return the embedding vector (typically 512 dimensions)
      return output.embeddings.data;
    } catch (error) {
      console.error('Embedding extraction error:', error);
      return null;
    }
  }

  /**
   * Extract embeddings for all speaker segments in the audio
   * @param {Float32Array} audio - Full audio data
   * @param {Array} segments - Diarization segments with start/end times
   * @returns {Array} Segments with embeddings attached
   */
  static async extractSegmentEmbeddings(audio, segments) {
    const sampleRate = 16000;
    const segmentsWithEmbeddings = [];

    for (const segment of segments) {
      const startSample = Math.floor(segment.start * sampleRate);
      const endSample = Math.floor(segment.end * sampleRate);
      const segmentAudio = audio.slice(startSample, endSample);

      // Skip very short segments (less than 0.5s)
      if (segmentAudio.length < sampleRate * 0.5) {
        segmentsWithEmbeddings.push({
          ...segment,
          embedding: null,
        });
        continue;
      }

      const embedding = await this.extractEmbedding(segmentAudio);
      segmentsWithEmbeddings.push({
        ...segment,
        embedding,
      });
    }

    return segmentsWithEmbeddings;
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
 * Transcribe audio chunk
 */
async function handleTranscribe({ audio, language = 'en', chunkIndex }) {
  try {
    const startTime = performance.now();

    // Convert audio array back to Float32Array if needed
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio);

    // Run ASR and diarization in parallel for best performance
    const [asrResult, segments] = await Promise.all([
      ModelManager.runTranscription(audioData),
      ModelManager.runSegmentation(audioData),
    ]);

    // Extract speaker embeddings for each segment
    const segmentsWithEmbeddings = await ModelManager.extractSegmentEmbeddings(
      audioData,
      segments
    );

    const processingTime = performance.now() - startTime;

    self.postMessage({
      type: 'result',
      data: {
        transcript: asrResult,
        segments: segmentsWithEmbeddings,
        chunkIndex,
        processingTime,
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
