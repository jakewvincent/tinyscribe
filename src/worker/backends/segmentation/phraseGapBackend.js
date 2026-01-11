/**
 * Phrase Gap Backend
 *
 * Wraps the existing PhraseDetector to implement the SegmentationBackend interface.
 * This provides text-based segmentation using gaps between Whisper word timestamps.
 *
 * This is the default segmentation method - lightweight and requires no model download.
 *
 * Tunable parameters:
 * - gapThreshold: Gap between words that triggers phrase boundary (seconds)
 * - minPhraseDuration: Minimum phrase duration for embedding extraction (seconds)
 */

import { SegmentationBackend } from './segmentationBackend.js';
import { PhraseDetector } from '../../../core/transcription/phraseDetector.js';
import { getDefaultSegmentationParams } from '../../../config/segmentation.js';

export class PhraseGapBackend extends SegmentationBackend {
  constructor() {
    super();
    this.phraseDetector = null;
  }

  /**
   * Load the phrase detector (no model download required)
   * @param {import('../../../config/segmentation.js').SegmentationModelConfig} modelConfig
   * @param {function} [progressCallback]
   * @param {Record<string, number>} [initialParams] - Initial parameter values
   */
  async load(modelConfig, progressCallback, initialParams = {}) {
    this.modelConfig = modelConfig;

    // Set initial params (merge with defaults)
    const defaults = getDefaultSegmentationParams(modelConfig.id);
    this.params = { ...defaults, ...initialParams };

    // Create PhraseDetector with current params
    this._createPhraseDetector();
    this.isLoaded = true;

    // Notify progress immediately since there's no model to download
    if (progressCallback) {
      progressCallback({
        status: 'done',
        name: modelConfig.name,
        progress: 1,
      });
    }

    console.log(`[PhraseGapBackend] Initialized ${modelConfig.name} with params:`, this.params);
  }

  /**
   * Create or recreate PhraseDetector with current params
   * @private
   */
  _createPhraseDetector() {
    this.phraseDetector = new PhraseDetector({
      gapThreshold: this.params.gapThreshold,
      minPhraseDuration: this.params.minPhraseDuration,
    });
  }

  /**
   * Set parameters and recreate phrase detector
   * @param {Record<string, number>} newParams
   */
  setParams(newParams) {
    super.setParams(newParams);
    // Recreate phrase detector with new params
    this._createPhraseDetector();
  }

  /**
   * Segment audio using word timestamp gaps
   * @param {Float32Array} audioFloat32 - Audio at 16kHz (used for duration calculation)
   * @param {Object} options
   * @param {Array} options.words - Whisper words with timestamps
   * @returns {Promise<import('./segmentationBackend.js').SegmentationResult>}
   */
  async segment(audioFloat32, options = {}) {
    const { words = [] } = options;
    const audioDuration = audioFloat32.length / 16000;

    if (!words.length) {
      return {
        segments: [],
        audioDuration,
        method: 'text-gap',
      };
    }

    // Use existing phrase detection logic
    const phrases = this.phraseDetector.detectPhrases(words);

    // Convert to unified segment format
    // Note: Text-gap doesn't assign speaker IDs - that happens in clustering
    // We set acousticSpeakerId to -1 to indicate "unknown, needs clustering"
    const segments = phrases.map(phrase => ({
      words: phrase.words,
      start: phrase.start,
      end: phrase.end,
      acousticSpeakerId: -1, // Unknown - will be determined by embedding clustering
    }));

    return {
      segments,
      audioDuration,
      method: 'text-gap',
    };
  }

  /**
   * Get the phrase detector instance (for debugging/testing)
   * @returns {PhraseDetector|null}
   */
  getPhraseDetector() {
    return this.phraseDetector;
  }

  async dispose() {
    this.phraseDetector = null;
    await super.dispose();
  }
}

export default PhraseGapBackend;
