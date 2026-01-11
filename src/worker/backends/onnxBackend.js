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
import { EmbeddingBackend } from './embeddingBackend.js';

// ============================================================================
// Pure JavaScript audio processing utilities (no ONNX dependencies)
// ============================================================================

/**
 * Create a Hanning window
 * @param {number} length - Window length
 * @returns {Float32Array}
 */
function createHannWindow(length) {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}

/**
 * Convert frequency to mel scale (HTK formula)
 * @param {number} freq - Frequency in Hz
 * @returns {number} Mel value
 */
function hzToMel(freq) {
  return 2595 * Math.log10(1 + freq / 700);
}

/**
 * Convert mel to frequency (HTK formula)
 * @param {number} mel - Mel value
 * @returns {number} Frequency in Hz
 */
function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Create mel filter bank matrix
 * @param {number} numFreqBins - Number of FFT frequency bins
 * @param {number} numMelBins - Number of mel filters
 * @param {number} minFreq - Minimum frequency
 * @param {number} maxFreq - Maximum frequency
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array[]} Array of mel filters, each of length numFreqBins
 */
function createMelFilterBank(numFreqBins, numMelBins, minFreq, maxFreq, sampleRate) {
  const minMel = hzToMel(minFreq);
  const maxMel = hzToMel(maxFreq);

  // Create numMelBins + 2 points evenly spaced in mel scale
  const melPoints = new Float32Array(numMelBins + 2);
  for (let i = 0; i < numMelBins + 2; i++) {
    melPoints[i] = minMel + (i * (maxMel - minMel)) / (numMelBins + 1);
  }

  // Convert back to Hz
  const hzPoints = melPoints.map(melToHz);

  // Convert to FFT bin indices
  const binPoints = hzPoints.map(hz =>
    Math.floor((numFreqBins * 2 - 1) * hz / sampleRate)
  );

  // Create triangular filters
  const filters = [];
  for (let m = 0; m < numMelBins; m++) {
    const filter = new Float32Array(numFreqBins);
    const startBin = binPoints[m];
    const centerBin = binPoints[m + 1];
    const endBin = binPoints[m + 2];

    // Rising edge
    for (let k = startBin; k < centerBin && k < numFreqBins; k++) {
      if (centerBin !== startBin) {
        filter[k] = (k - startBin) / (centerBin - startBin);
      }
    }

    // Falling edge
    for (let k = centerBin; k < endBin && k < numFreqBins; k++) {
      if (endBin !== centerBin) {
        filter[k] = (endBin - k) / (endBin - centerBin);
      }
    }

    // Slaney normalization: divide by the width of the mel band
    const melWidth = melPoints[m + 2] - melPoints[m];
    if (melWidth > 0) {
      for (let k = 0; k < numFreqBins; k++) {
        filter[k] *= 2 / melWidth;
      }
    }

    filters.push(filter);
  }

  return filters;
}

/**
 * Compute FFT of real signal using radix-2 Cooley-Tukey algorithm
 * @param {Float32Array} signal - Input signal (must be power of 2 length)
 * @returns {{real: Float32Array, imag: Float32Array}} Complex FFT result
 */
function fft(signal) {
  const n = signal.length;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  // Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    let j = 0;
    let x = i;
    for (let k = 0; k < Math.log2(n); k++) {
      j = (j << 1) | (x & 1);
      x >>= 1;
    }
    real[j] = signal[i];
  }

  // Cooley-Tukey FFT
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const step = (2 * Math.PI) / size;

    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const angle = -step * j;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const evenIdx = i + j;
        const oddIdx = i + j + halfSize;

        const tReal = cos * real[oddIdx] - sin * imag[oddIdx];
        const tImag = sin * real[oddIdx] + cos * imag[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] = real[evenIdx] + tReal;
        imag[evenIdx] = imag[evenIdx] + tImag;
      }
    }
  }

  return { real, imag };
}

/**
 * Compute power spectrum from FFT
 * @param {{real: Float32Array, imag: Float32Array}} fftResult
 * @param {number} numBins - Number of frequency bins to return
 * @returns {Float32Array} Power spectrum
 */
function powerSpectrum(fftResult, numBins) {
  const power = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) {
    power[i] = fftResult.real[i] * fftResult.real[i] + fftResult.imag[i] * fftResult.imag[i];
  }
  return power;
}

/**
 * Compute log mel spectrogram from audio
 * @param {Float32Array} audio - Input audio samples
 * @param {Float32Array} window - Window function
 * @param {number} frameLength - Frame length in samples
 * @param {number} hopLength - Hop length in samples
 * @param {number} fftSize - FFT size
 * @param {Float32Array[]} melFilters - Mel filter bank
 * @param {number} melFloor - Minimum value for log (prevents -Inf)
 * @returns {{data: Float32Array, numFrames: number, numMelBins: number}}
 */
function computeLogMelSpectrogram(audio, window, frameLength, hopLength, fftSize, melFilters, melFloor = 1e-10) {
  const numMelBins = melFilters.length;
  const numFreqBins = Math.floor(fftSize / 2) + 1;

  // Pad audio for center alignment
  const padLength = Math.floor(fftSize / 2);
  const paddedAudio = new Float32Array(audio.length + 2 * padLength);

  // Reflect padding
  for (let i = 0; i < padLength; i++) {
    paddedAudio[i] = audio[Math.min(padLength - i, audio.length - 1)];
    paddedAudio[paddedAudio.length - 1 - i] = audio[Math.max(0, audio.length - 1 - (padLength - i))];
  }
  paddedAudio.set(audio, padLength);

  // Calculate number of frames
  const numFrames = Math.floor((paddedAudio.length - frameLength) / hopLength) + 1;

  // Allocate output: [numFrames, numMelBins] in row-major order
  const melSpec = new Float32Array(numFrames * numMelBins);

  // Process each frame
  const frame = new Float32Array(fftSize);

  for (let t = 0; t < numFrames; t++) {
    const start = t * hopLength;

    // Apply window and zero-pad to FFT size
    frame.fill(0);
    for (let i = 0; i < frameLength && (start + i) < paddedAudio.length; i++) {
      frame[i] = paddedAudio[start + i] * window[i];
    }

    // Compute FFT and power spectrum
    const fftResult = fft(frame);
    const power = powerSpectrum(fftResult, numFreqBins);

    // Apply mel filters and compute log
    for (let m = 0; m < numMelBins; m++) {
      let melEnergy = 0;
      const filter = melFilters[m];
      for (let k = 0; k < numFreqBins; k++) {
        melEnergy += power[k] * filter[k];
      }
      // Log with floor to prevent -Inf
      melSpec[t * numMelBins + m] = Math.log(Math.max(melEnergy, melFloor));
    }
  }

  return {
    data: melSpec,
    numFrames,
    numMelBins,
  };
}

// ============================================================================
// ONNX Backend Implementation
// ============================================================================

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

    // Pre-compute mel filter bank matrix using our pure JS implementation
    const numFreqBins = Math.floor(FFT_SIZE / 2) + 1; // 257 bins for FFT_SIZE=512
    this.melFilters = createMelFilterBank(
      numFreqBins,
      NUM_MEL_BINS,
      MIN_FREQ,
      MAX_FREQ,
      SAMPLE_RATE
    );

    // Pre-compute Hanning window using our pure JS implementation
    this.window = createHannWindow(FRAME_LENGTH);

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
      // 1. Compute mel spectrogram features (pure JS, no async)
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
    const result = computeLogMelSpectrogram(
      audio,
      this.window,
      FRAME_LENGTH,
      HOP_LENGTH,
      FFT_SIZE,
      this.melFilters,
      1e-10  // mel floor
    );

    // Apply per-feature mean-variance normalization
    this.normalizeFeatures(result.data);

    return result;
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
