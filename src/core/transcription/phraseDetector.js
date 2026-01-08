/**
 * PhraseDetector - Detects phrase boundaries from Whisper word timestamps
 * and extracts speaker embeddings per phrase from WavLM frame features.
 */

import { PHRASE_DEFAULTS } from '../../config/index.js';

export class PhraseDetector {
  /**
   * @param {Object} [options] - Configuration options
   * @param {number} [options.gapThreshold] - Gap in seconds that triggers phrase boundary
   * @param {number} [options.minPhraseDuration] - Minimum phrase duration in seconds
   * @param {number} [options.frameRate] - WavLM frame rate (frames per second)
   */
  constructor(options = {}) {
    // Apply defaults from config
    const config = { ...PHRASE_DEFAULTS, ...options };

    this.gapThreshold = config.gapThreshold;
    this.minPhraseDuration = config.minPhraseDuration;
    this.frameRate = config.frameRate;
  }

  /**
   * Detect phrase boundaries from word timestamps based on gaps between words
   * @param {Array} chunks - Whisper chunks [{text, timestamp: [start, end]}, ...]
   * @returns {Array} phrases - [{words: [...], start, end}, ...]
   */
  detectPhrases(chunks) {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const phrases = [];
    let currentPhrase = {
      words: [],
      start: null,
      end: null,
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const [wordStart, wordEnd] = chunk.timestamp;

      // Skip chunks with invalid timestamps
      if (wordStart === null || wordEnd === null) {
        continue;
      }

      // If this is the first word in current phrase
      if (currentPhrase.words.length === 0) {
        currentPhrase.words.push(chunk);
        currentPhrase.start = wordStart;
        currentPhrase.end = wordEnd;
        continue;
      }

      // Calculate gap between previous word end and current word start
      const gap = wordStart - currentPhrase.end;

      if (gap >= this.gapThreshold) {
        // Gap is large enough - finalize current phrase and start new one
        phrases.push({ ...currentPhrase });
        currentPhrase = {
          words: [chunk],
          start: wordStart,
          end: wordEnd,
        };
      } else {
        // Continue current phrase
        currentPhrase.words.push(chunk);
        currentPhrase.end = wordEnd;
      }
    }

    // Don't forget the last phrase
    if (currentPhrase.words.length > 0) {
      phrases.push(currentPhrase);
    }

    return phrases;
  }

  /**
   * Extract embeddings for each phrase from WavLM frame features
   * @param {Object} frameFeatures - Tensor with dims [1, frames, hidden_dim] and data array
   * @param {Array} phrases - from detectPhrases()
   * @param {number} audioDuration - Total audio duration in seconds
   * @returns {Array} phrases with embeddings added
   */
  extractPhraseEmbeddings(frameFeatures, phrases, audioDuration) {
    if (!frameFeatures || !frameFeatures.dims || !frameFeatures.data) {
      console.error('Invalid frame features provided');
      return phrases.map(p => ({ ...p, embedding: null }));
    }

    const [batchSize, numFrames, hiddenDim] = frameFeatures.dims;
    const data = frameFeatures.data;

    // Calculate actual frame rate based on audio duration and number of frames
    const actualFrameRate = numFrames / audioDuration;

    return phrases.map(phrase => {
      const duration = phrase.end - phrase.start;

      // Calculate frame range for this phrase
      const startFrame = Math.floor(phrase.start * actualFrameRate);
      const endFrame = Math.min(Math.ceil(phrase.end * actualFrameRate), numFrames);
      const frameCount = Math.max(0, endFrame - startFrame);

      // Skip phrases that are too short for reliable embedding
      if (duration < this.minPhraseDuration) {
        return {
          ...phrase,
          embedding: null,
          frameCount,
          reason: 'too_short',
        };
      }

      // Ensure we have at least some frames
      if (endFrame <= startFrame) {
        return {
          ...phrase,
          embedding: null,
          frameCount: 0,
          reason: 'no_frames',
        };
      }

      // Mean pool frames for this phrase
      const embedding = new Float32Array(hiddenDim);

      for (let f = startFrame; f < endFrame; f++) {
        const frameOffset = f * hiddenDim;
        for (let d = 0; d < hiddenDim; d++) {
          embedding[d] += data[frameOffset + d];
        }
      }

      // Divide by frame count for mean
      for (let d = 0; d < hiddenDim; d++) {
        embedding[d] /= frameCount;
      }

      return {
        ...phrase,
        embedding,
        frameCount,
      };
    });
  }

  /**
   * Get the combined text of a phrase
   * @param {Object} phrase - Phrase object with words array
   * @returns {string} Combined text
   */
  getPhraseText(phrase) {
    return phrase.words.map(w => w.text).join('').trim();
  }
}
