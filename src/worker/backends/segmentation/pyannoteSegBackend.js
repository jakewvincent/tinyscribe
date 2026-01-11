/**
 * Pyannote Segmentation Backend
 *
 * Uses pyannote-segmentation-3.0 via Transformers.js for acoustic
 * speaker segmentation. Detects speaker boundaries directly from
 * audio waveform, independent of ASR word timing.
 *
 * Model details:
 * - Input: 16kHz audio waveform
 * - Output: 7-class frame-level logits (powerset encoding for up to 3 speakers)
 * - Classes: 0=silence, 1=spk0, 2=spk1, 3=spk2, 4=spk0+1, 5=spk0+2, 6=spk1+2
 *
 * The processor's post_process_speaker_diarization() method converts
 * frame-level logits to segment boundaries with speaker IDs.
 *
 * Tunable parameters:
 * - minSegmentDuration: Filter out segments shorter than this
 * - segmentPadding: Extend segment boundaries by this amount
 * - mergeGapThreshold: Merge same-speaker segments if gap is smaller
 * - minConfidence: Filter out segments with lower confidence
 */

import { AutoProcessor, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { SegmentationBackend } from './segmentationBackend.js';
import { getDefaultSegmentationParams } from '../../../config/segmentation.js';

export class PyannoteSegBackend extends SegmentationBackend {
  constructor() {
    super();
    this.model = null;
    this.processor = null;
  }

  /**
   * Load the pyannote segmentation model
   * @param {import('../../../config/segmentation.js').SegmentationModelConfig} modelConfig
   * @param {function} [progressCallback]
   * @param {Record<string, number>} [initialParams] - Initial parameter values
   */
  async load(modelConfig, progressCallback, initialParams = {}) {
    this.modelConfig = modelConfig;
    const modelId = modelConfig.source;

    // Set initial params (merge with defaults)
    const defaults = getDefaultSegmentationParams(modelConfig.id);
    this.params = { ...defaults, ...initialParams };

    console.log(`[PyannoteSegBackend] Loading ${modelConfig.name} from ${modelId}...`);

    // Load processor first
    this.processor = await AutoProcessor.from_pretrained(modelId, {
      progress_callback: progressCallback,
    });

    // Load model - use WASM backend for compatibility
    this.model = await AutoModelForAudioFrameClassification.from_pretrained(modelId, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: progressCallback,
    });

    this.isLoaded = true;
    console.log(`[PyannoteSegBackend] Loaded ${modelConfig.name} with params:`, this.params);
  }

  /**
   * Segment audio into speaker turns using acoustic analysis
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @param {Object} [options] - Options (words not used for acoustic segmentation)
   * @returns {Promise<import('./segmentationBackend.js').SegmentationResult>}
   */
  async segment(audioFloat32, options = {}) {
    if (!this.isReady()) {
      throw new Error('[PyannoteSegBackend] Model not loaded');
    }

    const audioDuration = audioFloat32.length / 16000;

    try {
      // Process audio through the model
      const inputs = await this.processor(audioFloat32);
      const output = await this.model(inputs);

      // Get frame-level logits
      const { logits } = output;

      // Use built-in post-processing to convert logits to segments
      // This handles the powerset decoding and segment merging
      const result = this.processor.post_process_speaker_diarization(
        logits,
        audioFloat32.length
      );

      // Result is array of batches, we have batch size 1
      const rawSegments = result[0] || [];
      const rawCount = rawSegments.length;

      // Convert to our unified format
      let segments = rawSegments.map(seg => ({
        speakerId: seg.id,
        start: seg.start,
        end: seg.end,
        confidence: seg.confidence,
      }));

      // Apply post-processing based on params
      segments = this._postProcess(segments, audioDuration);

      // Debug logging
      console.log(
        `[PyannoteSegBackend] Segmented ${audioDuration.toFixed(2)}s audio: ` +
        `${rawCount} raw → ${segments.length} filtered ` +
        `(${new Set(segments.map(s => s.speakerId)).size} speakers)`
      );

      if (segments.length > 0) {
        const speakerCounts = {};
        for (const seg of segments) {
          speakerCounts[seg.speakerId] = (speakerCounts[seg.speakerId] || 0) + 1;
        }
        console.log('[PyannoteSegBackend] Speaker distribution:', speakerCounts);
      }

      return {
        segments,
        audioDuration,
        method: 'acoustic',
      };
    } catch (error) {
      console.error('[PyannoteSegBackend] Segmentation error:', error);

      // Return empty result on error rather than throwing
      return {
        segments: [],
        audioDuration,
        method: 'acoustic',
        error: error.message,
      };
    }
  }

  /**
   * Apply post-processing filters based on current params
   * @param {Array} segments - Raw segments from model
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
    // Sort by start time first
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const merged = [];

    for (const seg of sorted) {
      if (merged.length === 0) {
        merged.push({ ...seg });
        continue;
      }

      const last = merged[merged.length - 1];

      // Check if same speaker and gap is small enough
      if (seg.speakerId === last.speakerId && (seg.start - last.end) <= maxGap) {
        // Merge: extend end time, average confidence
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
    if (this.model && typeof this.model.dispose === 'function') {
      await this.model.dispose();
    }
    if (this.processor && typeof this.processor.dispose === 'function') {
      await this.processor.dispose();
    }
    this.model = null;
    this.processor = null;
    await super.dispose();
  }
}

export default PyannoteSegBackend;
