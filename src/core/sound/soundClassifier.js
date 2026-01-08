/**
 * Sound Classifier
 * Classifies audio markers as human voice sounds, environmental sounds, or blank audio
 */

import { SOUND_CLASSIFICATION } from '../../config/index.js';

/**
 * Sound classification types
 */
export const SoundType = {
  SPEECH: 'speech',
  HUMAN_VOICE: 'human_voice',
  ENVIRONMENTAL: 'environmental',
  BLANK: 'blank',
};

export class SoundClassifier {
  /**
   * @param {Object} [options] - Configuration options
   * @param {string[]} [options.humanVoicePatterns] - Patterns for human voice sounds
   * @param {string[]} [options.environmentalPatterns] - Patterns for environmental sounds
   */
  constructor(options = {}) {
    this.humanVoicePatterns = options.humanVoicePatterns || SOUND_CLASSIFICATION.humanVoicePatterns;
    this.environmentalPatterns = options.environmentalPatterns || SOUND_CLASSIFICATION.environmentalPatterns;
  }

  /**
   * Check if text is a bracketed marker like [MUSIC] or [LAUGHTER]
   * @param {string} text - Text to check
   * @returns {boolean}
   */
  isBracketedMarker(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^\[.*\]$/.test(trimmed) || /^\(.*\)$/.test(trimmed);
  }

  /**
   * Check if text is a human voice sound (can be attributed to speaker)
   * @param {string} text - Text to check
   * @returns {boolean}
   */
  isHumanVoiceSound(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return this.humanVoicePatterns.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if text is an environmental sound (should NOT be attributed to speaker)
   * Default: unknown bracketed markers are treated as environmental (safer)
   * @param {string} text - Text to check
   * @returns {boolean}
   */
  isEnvironmentalSound(text) {
    if (!text) return false;
    const trimmed = text.trim();

    // Check if it's a bracketed marker
    if (!this.isBracketedMarker(trimmed)) {
      return false; // Regular speech, not environmental
    }

    // If it matches human voice patterns, it's NOT environmental
    if (this.isHumanVoiceSound(trimmed)) {
      return false;
    }

    // All other bracketed markers are environmental (safer default)
    return true;
  }

  /**
   * Check if text is BLANK_AUDIO specifically (should be filtered out entirely)
   * @param {string} text - Text to check
   * @returns {boolean}
   */
  isBlankAudio(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^\[BLANK/i.test(trimmed) || /^AUDIO\]$/i.test(trimmed);
  }

  /**
   * Classify text into a sound type
   * @param {string} text - Text to classify
   * @returns {string} One of SoundType values: 'speech', 'human_voice', 'environmental', 'blank'
   */
  classify(text) {
    if (!text) return SoundType.BLANK;

    if (this.isBlankAudio(text)) {
      return SoundType.BLANK;
    }

    if (!this.isBracketedMarker(text)) {
      return SoundType.SPEECH;
    }

    if (this.isHumanVoiceSound(text)) {
      return SoundType.HUMAN_VOICE;
    }

    return SoundType.ENVIRONMENTAL;
  }

  /**
   * Check if phrase contains only BLANK_AUDIO (should be excluded entirely)
   * @param {Object} phrase - Phrase object with words array
   * @returns {boolean}
   */
  isBlankAudioOnly(phrase) {
    if (!phrase.words || phrase.words.length === 0) return true;
    return phrase.words.every((w) => this.isBlankAudio(w.text));
  }

  /**
   * Check if phrase contains only environmental sounds (no speech)
   * @param {Object} phrase - Phrase object with words array
   * @returns {boolean}
   */
  isEnvironmentalOnly(phrase) {
    if (!phrase.words || phrase.words.length === 0) return true;
    return phrase.words.every((w) => {
      const text = w.text?.trim();
      if (!text) return true;
      return this.isEnvironmentalSound(text);
    });
  }

  /**
   * Categorize a phrase
   * @param {Object} phrase - Phrase object with words array
   * @returns {'blank'|'environmental'|'speech'} Category
   */
  categorizePhrase(phrase) {
    if (this.isBlankAudioOnly(phrase)) {
      return 'blank';
    }
    if (this.isEnvironmentalOnly(phrase)) {
      return 'environmental';
    }
    return 'speech';
  }
}
