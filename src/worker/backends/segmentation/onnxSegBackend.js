/**
 * Raw ONNX Backend for Speaker Segmentation
 *
 * Uses onnxruntime-web directly to run ONNX speaker segmentation models.
 * This allows using raw ONNX files from sherpa-onnx releases without
 * requiring Transformers.js-compatible HuggingFace repos.
 *
 * Supported models (pyannote-style architecture):
 * - pyannote-segmentation-3.0
 * - reverb-diarization-v1
 *
 * Model details:
 * - Input: 16kHz audio waveform
 * - Output: 7-class frame-level logits (powerset encoding for up to 3 speakers)
 * - Classes: 0=silence, 1=spk0, 2=spk1, 3=spk2, 4=spk0+1, 5=spk0+2, 6=spk1+2
 * - Frame step: 270 samples (16.875ms)
 * - Frame offset: 990 samples
 */

import * as ort from 'onnxruntime-web';
import { SegmentationBackend } from './segmentationBackend.js';
import { getDefaultSegmentationParams } from '../../../config/segmentation.js';

// Pyannote model frame parameters
const SAMPLE_RATE = 16000;
const FRAME_STEP = 270;    // samples per frame
const FRAME_OFFSET = 990;  // initial offset in samples

// Powerset class definitions (7 classes for up to 3 speakers)
const POWERSET_CLASSES = {
  0: [],           // NO_SPEAKER (silence)
  1: [0],          // SPEAKER_1 only
  2: [1],          // SPEAKER_2 only
  3: [2],          // SPEAKER_3 only
  4: [0, 1],       // SPEAKERS_1_AND_2
  5: [0, 2],       // SPEAKERS_1_AND_3
  6: [1, 2],       // SPEAKERS_2_AND_3
};

export class OnnxSegBackend extends SegmentationBackend {
  constructor() {
    super();
    this.session = null;
  }

  /**
   * Load the ONNX segmentation model
   * @param {import('../../../config/segmentation.js').SegmentationModelConfig} modelConfig
   * @param {function} [progressCallback]
   * @param {Record<string, number>} [initialParams] - Initial parameter values
   */
  async load(modelConfig, progressCallback, initialParams = {}) {
    this.modelConfig = modelConfig;
    const modelUrl = modelConfig.source;

    // Set initial params (merge with defaults)
    const defaults = getDefaultSegmentationParams(modelConfig.id);
    this.params = { ...defaults, ...initialParams };

    console.log(`[OnnxSegBackend] Loading ${modelConfig.name} from ${modelUrl}...`);

    // Report loading start
    if (progressCallback) {
      progressCallback({ status: 'initiate', file: modelConfig.name });
    }

    // Fetch model file
    const modelBuffer = await this._fetchModel(modelUrl, progressCallback);

    // Create ONNX session
    const sessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };

    this.session = await ort.InferenceSession.create(modelBuffer.buffer, sessionOptions);

    this.isLoaded = true;
    console.log(`[OnnxSegBackend] Loaded ${modelConfig.name} with params:`, this.params);

    if (progressCallback) {
      progressCallback({ status: 'done', file: modelConfig.name });
    }
  }

  /**
   * Fetch model file with progress tracking
   * @param {string} url - Model URL
   * @param {function} [progressCallback]
   * @returns {Promise<Uint8Array>}
   * @private
   */
  async _fetchModel(url, progressCallback) {
    // Handle proxied URLs for sherpa-onnx models
    const fetchUrl = this._resolveModelUrl(url);

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      if (progressCallback && total > 0) {
        progressCallback({
          status: 'progress',
          file: this.modelConfig.name,
          loaded,
          total,
          progress: loaded / total,
        });
      }
    }

    // Combine chunks
    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Resolve model URL (handle proxied paths)
   * @param {string} url
   * @returns {string}
   * @private
   */
  _resolveModelUrl(url) {
    // If it's already a full URL, use it
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // If it's a relative path, assume it's proxied
    if (url.startsWith('/')) {
      return url;
    }

    // Otherwise, construct the sherpa-onnx GitHub URL
    return `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/${url}`;
  }

  /**
   * Segment audio into speaker turns using acoustic analysis
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @param {Object} [options] - Options (not used for acoustic segmentation)
   * @returns {Promise<import('./segmentationBackend.js').SegmentationResult>}
   */
  async segment(audioFloat32, options = {}) {
    if (!this.isReady()) {
      throw new Error('[OnnxSegBackend] Model not loaded');
    }

    const audioDuration = audioFloat32.length / SAMPLE_RATE;

    try {
      // Run inference
      const inputTensor = new ort.Tensor('float32', audioFloat32, [1, audioFloat32.length]);
      const feeds = { input: inputTensor };
      const results = await this.session.run(feeds);

      // Get output logits - shape is typically [1, num_frames, 7]
      const output = results.logits || results.output || Object.values(results)[0];
      const logits = output.data;
      const numFrames = output.dims[1];
      const numClasses = output.dims[2];

      // Decode powerset logits to segments
      const rawSegments = this._decodeLogits(logits, numFrames, numClasses, audioDuration);
      const rawCount = rawSegments.length;

      // Apply post-processing based on params
      const segments = this._postProcess(rawSegments, audioDuration);

      // Debug logging
      console.log(
        `[OnnxSegBackend] Segmented ${audioDuration.toFixed(2)}s audio: ` +
        `${rawCount} raw -> ${segments.length} filtered ` +
        `(${new Set(segments.map(s => s.speakerId)).size} speakers)`
      );

      return {
        segments,
        audioDuration,
        method: 'acoustic',
      };
    } catch (error) {
      console.error('[OnnxSegBackend] Segmentation error:', error);
      return {
        segments: [],
        audioDuration,
        method: 'acoustic',
        error: error.message,
      };
    }
  }

  /**
   * Decode frame-level powerset logits into speaker segments
   * @param {Float32Array} logits - Raw model output [num_frames * num_classes]
   * @param {number} numFrames
   * @param {number} numClasses
   * @param {number} audioDuration
   * @returns {Array} Array of {speakerId, start, end, confidence}
   * @private
   */
  _decodeLogits(logits, numFrames, numClasses, audioDuration) {
    const segments = [];

    // Track active speaker segments
    const activeSegments = new Map(); // speakerId -> {start, confidences}

    for (let frame = 0; frame < numFrames; frame++) {
      // Get frame time
      const frameStart = (FRAME_OFFSET + frame * FRAME_STEP) / SAMPLE_RATE;

      // Get class probabilities via softmax
      const frameLogits = [];
      for (let c = 0; c < numClasses; c++) {
        frameLogits.push(logits[frame * numClasses + c]);
      }
      const probs = this._softmax(frameLogits);

      // Find best class
      let bestClass = 0;
      let bestProb = probs[0];
      for (let c = 1; c < numClasses; c++) {
        if (probs[c] > bestProb) {
          bestProb = probs[c];
          bestClass = c;
        }
      }

      // Get speakers active in this frame
      const activeSpeakers = new Set(POWERSET_CLASSES[bestClass] || []);

      // Close segments for speakers no longer active
      for (const [speakerId, segment] of activeSegments.entries()) {
        if (!activeSpeakers.has(speakerId)) {
          // Close this segment
          const avgConfidence = segment.confidences.reduce((a, b) => a + b, 0) / segment.confidences.length;
          segments.push({
            speakerId: `SPEAKER_${speakerId}`,
            start: segment.start,
            end: frameStart,
            confidence: avgConfidence,
          });
          activeSegments.delete(speakerId);
        }
      }

      // Open/extend segments for active speakers
      for (const speakerId of activeSpeakers) {
        if (activeSegments.has(speakerId)) {
          // Extend existing segment
          activeSegments.get(speakerId).confidences.push(bestProb);
        } else {
          // Start new segment
          activeSegments.set(speakerId, {
            start: frameStart,
            confidences: [bestProb],
          });
        }
      }
    }

    // Close any remaining open segments
    const finalTime = audioDuration;
    for (const [speakerId, segment] of activeSegments.entries()) {
      const avgConfidence = segment.confidences.reduce((a, b) => a + b, 0) / segment.confidences.length;
      segments.push({
        speakerId: `SPEAKER_${speakerId}`,
        start: segment.start,
        end: finalTime,
        confidence: avgConfidence,
      });
    }

    // Sort by start time
    segments.sort((a, b) => a.start - b.start);

    return segments;
  }

  /**
   * Compute softmax probabilities
   * @param {number[]} logits
   * @returns {number[]}
   * @private
   */
  _softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  /**
   * Apply post-processing filters based on current params
   * @param {Array} segments - Raw segments from decoding
   * @param {number} audioDuration - Total audio duration
   * @returns {Array} Filtered and merged segments
   * @private
   */
  _postProcess(segments, audioDuration) {
    const {
      minSegmentDuration = 0,
      segmentPadding = 0,
      mergeGapThreshold = 0.5,
      minConfidence = 0,
    } = this.params;

    let filtered = segments;

    // Step 1: Filter by confidence
    if (minConfidence > 0) {
      filtered = filtered.filter(seg => seg.confidence >= minConfidence);
    }

    // Step 2: Filter by minimum duration
    if (minSegmentDuration > 0) {
      filtered = filtered.filter(seg => (seg.end - seg.start) >= minSegmentDuration);
    }

    // Step 3: Apply padding (extend boundaries)
    if (segmentPadding > 0) {
      filtered = filtered.map(seg => ({
        ...seg,
        start: Math.max(0, seg.start - segmentPadding),
        end: Math.min(audioDuration, seg.end + segmentPadding),
      }));
    }

    // Step 4: Merge same-speaker segments with small gaps
    if (mergeGapThreshold > 0 && filtered.length > 1) {
      filtered = this._mergeSameSpeakerSegments(filtered, mergeGapThreshold);
    }

    return filtered;
  }

  /**
   * Merge consecutive segments of the same speaker if gap is small
   * @param {Array} segments - Segments sorted by start time
   * @param {number} maxGap - Maximum gap to merge across
   * @returns {Array} Merged segments
   * @private
   */
  _mergeSameSpeakerSegments(segments, maxGap) {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const merged = [];

    for (const seg of sorted) {
      if (merged.length === 0) {
        merged.push({ ...seg });
        continue;
      }

      const last = merged[merged.length - 1];

      if (seg.speakerId === last.speakerId && (seg.start - last.end) <= maxGap) {
        last.end = Math.max(last.end, seg.end);
        last.confidence = (last.confidence + seg.confidence) / 2;
      } else {
        merged.push({ ...seg });
      }
    }

    return merged;
  }

  /**
   * Dispose of model resources
   */
  async dispose() {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    await super.dispose();
  }
}

export default OnnxSegBackend;
