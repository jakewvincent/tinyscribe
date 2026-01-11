/**
 * ONNX Runtime Web Backend for Speaker Embeddings
 *
 * Uses onnxruntime-web directly to run ONNX speaker embedding models
 * from sherpa-onnx's releases. Implements mel filterbank preprocessing
 * using Transformers.js audio utilities.
 *
 * Supported models:
 * - 3D-Speaker ERes2Net (192-dim)
 * - WeSpeaker ECAPA-TDNN / CAM++ (512-dim)
 */

import * as ort from 'onnxruntime-web';
import { mel_filter_bank, spectrogram, window_function } from '@huggingface/transformers';
import { EmbeddingBackend } from './embeddingBackend.js';

// Audio preprocessing constants for speaker embedding models
// These match the settings used by sherpa-onnx for their speaker models
const SAMPLE_RATE = 16000;
const NUM_MEL_BINS = 80;
const FRAME_LENGTH_MS = 25;
const FRAME_SHIFT_MS = 10;
const FRAME_LENGTH = Math.floor(SAMPLE_RATE * FRAME_LENGTH_MS / 1000); // 400 samples
const HOP_LENGTH = Math.floor(SAMPLE_RATE * FRAME_SHIFT_MS / 1000);    // 160 samples
const FFT_SIZE = 512; // Next power of 2 above FRAME_LENGTH
const MIN_FREQ = 20;
const MAX_FREQ = SAMPLE_RATE / 2; // Nyquist frequency (8000 Hz)

export class OnnxBackend extends EmbeddingBackend {
  constructor() {
    super();
    this.session = null;
    this.melFilters = null;
    this.window = null;
  }

  /**
   * Load the ONNX model
   * @param {import('../../config/models.js').EmbeddingModelConfig} modelConfig
   * @param {function} [progressCallback]
   */
  async load(modelConfig, progressCallback) {
    this.modelConfig = modelConfig;

    let modelUrl = modelConfig.modelUrl;
    if (!modelUrl) {
      throw new Error(`Model "${modelConfig.name}" does not have a modelUrl configured`);
    }

    // GitHub release URLs don't support CORS
    // In development, we use Vite's proxy; in production, models should be hosted on a CORS-enabled CDN
    if (modelUrl.includes('github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/')) {
      // Use local proxy path (Vite will proxy to GitHub during development)
      const filename = modelUrl.split('/').pop();
      const proxyUrl = '/models/sherpa-onnx/' + filename;
      console.log(`[OnnxBackend] Using Vite proxy for GitHub model: ${filename}`);
      modelUrl = proxyUrl;
    }

    console.log(`[OnnxBackend] Loading model from ${modelConfig.modelUrl}`);

    // Configure ONNX Runtime for browser
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';

    // Fetch the model file with progress tracking
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    let loadedBytes = 0;

    // Stream the response to track progress
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loadedBytes += value.length;

      if (progressCallback && totalBytes > 0) {
        progressCallback({
          status: 'progress',
          name: modelConfig.source,
          loaded: loadedBytes,
          total: totalBytes,
          progress: loadedBytes / totalBytes,
        });
      }
    }

    // Combine chunks into single array buffer
    const modelBuffer = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      modelBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Create ONNX session
    console.log(`[OnnxBackend] Creating ONNX session (${(loadedBytes / 1024 / 1024).toFixed(1)} MB)`);

    // Use WASM backend with threading if available
    const sessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };

    this.session = await ort.InferenceSession.create(modelBuffer.buffer, sessionOptions);

    // Log input/output info for debugging
    console.log('[OnnxBackend] Model inputs:', this.session.inputNames);
    console.log('[OnnxBackend] Model outputs:', this.session.outputNames);

    // Pre-compute mel filter bank matrix
    // mel_filter_bank returns shape [num_frequency_bins, num_mel_filters]
    // We need [num_mel_filters, num_frequency_bins] for applying to spectrogram
    const numFreqBins = Math.floor(FFT_SIZE / 2) + 1; // 257 bins for FFT_SIZE=512
    this.melFilters = mel_filter_bank(
      numFreqBins,
      NUM_MEL_BINS,
      MIN_FREQ,
      MAX_FREQ,
      SAMPLE_RATE,
      'slaney',  // normalization
      'htk'      // mel scale (htk is more common for speaker embeddings)
    );

    // Pre-compute Hanning window
    this.window = window_function(FRAME_LENGTH, 'hann', { periodic: true });

    this.isLoaded = true;
    console.log(`[OnnxBackend] Loaded ${modelConfig.name} (${modelConfig.dimensions}-dim)`);

    if (progressCallback) {
      progressCallback({
        status: 'done',
        name: modelConfig.source,
      });
    }
  }

  /**
   * Extract speaker embedding from audio
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @returns {Promise<Float32Array|null>}
   */
  async extractEmbedding(audioFloat32) {
    if (!this.isLoaded || !this.session) {
      console.error('[OnnxBackend] Model not loaded');
      return null;
    }

    try {
      // 1. Compute mel spectrogram features
      const features = this.computeMelSpectrogram(audioFloat32);

      if (!features || features.data.length === 0) {
        console.error('[OnnxBackend] Failed to compute mel spectrogram');
        return null;
      }

      // 2. Run ONNX inference
      const embedding = await this.runInference(features);

      return embedding;
    } catch (error) {
      console.error('[OnnxBackend] Embedding extraction error:', error);
      return null;
    }
  }

  /**
   * Compute log mel spectrogram features from audio
   * @param {Float32Array} audio - Raw audio at 16kHz
   * @returns {Object} Features with shape [1, num_frames, num_mel_bins]
   */
  computeMelSpectrogram(audio) {
    // Use Transformers.js spectrogram function which handles:
    // - Windowing
    // - STFT computation
    // - Power spectrum
    // - Mel filter application
    // - Log scaling

    const result = spectrogram(
      audio,
      this.window,
      FRAME_LENGTH,
      HOP_LENGTH,
      {
        fft_length: FFT_SIZE,
        power: 2.0,  // Power spectrum
        center: true,
        pad_mode: 'reflect',
        mel_filters: this.melFilters,
        log_mel: 'log',  // Natural log
        mel_floor: 1e-10,
      }
    );

    // result is shape [num_mel_bins, num_frames] from spectrogram()
    // We need to transpose to [num_frames, num_mel_bins] for the model
    const numMelBins = result.dims[0];
    const numFrames = result.dims[1];
    const transposed = new Float32Array(numFrames * numMelBins);

    for (let t = 0; t < numFrames; t++) {
      for (let m = 0; m < numMelBins; m++) {
        transposed[t * numMelBins + m] = result.data[m * numFrames + t];
      }
    }

    // Apply global mean-variance normalization
    // This is commonly applied to speaker embedding features
    this.normalizeFeatures(transposed);

    return {
      data: transposed,
      numFrames,
      numMelBins,
    };
  }

  /**
   * Apply per-feature mean-variance normalization
   * @param {Float32Array} features - Features [num_frames, num_mel_bins]
   */
  normalizeFeatures(features) {
    const numFrames = features.length / NUM_MEL_BINS;

    // Compute mean and std per mel bin
    for (let m = 0; m < NUM_MEL_BINS; m++) {
      let sum = 0;
      let sumSq = 0;

      for (let t = 0; t < numFrames; t++) {
        const val = features[t * NUM_MEL_BINS + m];
        sum += val;
        sumSq += val * val;
      }

      const mean = sum / numFrames;
      const variance = (sumSq / numFrames) - (mean * mean);
      const std = Math.sqrt(Math.max(variance, 1e-10));

      // Normalize
      for (let t = 0; t < numFrames; t++) {
        features[t * NUM_MEL_BINS + m] = (features[t * NUM_MEL_BINS + m] - mean) / std;
      }
    }
  }

  /**
   * Run ONNX inference on features
   * @param {Object} features - Mel spectrogram features
   * @returns {Float32Array|null} Speaker embedding
   */
  async runInference(features) {
    // Most speaker embedding models expect input shape:
    // - [batch, time, features] for most ECAPA/ResNet models
    // - Some models may expect [batch, features, time]
    //
    // We'll try the common [batch, time, features] format first

    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];

    // Create input tensor with shape [1, num_frames, num_mel_bins]
    const inputTensor = new ort.Tensor(
      'float32',
      features.data,
      [1, features.numFrames, features.numMelBins]
    );

    try {
      // Run inference
      const results = await this.session.run({ [inputName]: inputTensor });
      const output = results[outputName];

      // Extract embedding from output
      const embedding = new Float32Array(output.data);

      // Diagnostic logging
      let norm = 0, min = Infinity, max = -Infinity, sum = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i] * embedding[i];
        sum += embedding[i];
        if (embedding[i] < min) min = embedding[i];
        if (embedding[i] > max) max = embedding[i];
      }
      console.log(
        `[OnnxBackend] dim=${embedding.length}, norm=${Math.sqrt(norm).toFixed(4)}, ` +
        `mean=${(sum / embedding.length).toFixed(6)}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`
      );

      return embedding;
    } catch (error) {
      // If the shape is wrong, try transposed format [batch, features, time]
      if (error.message.includes('shape') || error.message.includes('dimension')) {
        console.log('[OnnxBackend] Trying transposed input format [batch, features, time]');

        // Transpose features
        const transposedData = new Float32Array(features.data.length);
        for (let t = 0; t < features.numFrames; t++) {
          for (let m = 0; m < features.numMelBins; m++) {
            transposedData[m * features.numFrames + t] = features.data[t * features.numMelBins + m];
          }
        }

        const transposedTensor = new ort.Tensor(
          'float32',
          transposedData,
          [1, features.numMelBins, features.numFrames]
        );

        const results = await this.session.run({ [inputName]: transposedTensor });
        const output = results[outputName];

        return new Float32Array(output.data);
      }

      throw error;
    }
  }

  /**
   * Dispose of model resources
   */
  async dispose() {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.melFilters = null;
    this.window = null;
    await super.dispose();
  }
}

export default OnnxBackend;
