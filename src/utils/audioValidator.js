/**
 * Audio Validator
 * Performs audio quality checks and validation for enrollment recordings
 */

// Audio quality thresholds
const CLIPPING_THRESHOLD = 0.99;
const CLIPPING_RATIO_LIMIT = 0.001; // 0.1% of samples
const RMS_MIN = 0.01;
const RMS_MAX = 0.5;

// Speech content thresholds
const MIN_SPEECH_DURATION = 5.0; // seconds (grouped passages ~30 words, target 5-7s speech)
const MIN_SPEECH_RATIO = 0.5; // 50% (allow some pauses in longer passages)

// Transcription matching threshold
const TRANSCRIPTION_MATCH_THRESHOLD = 0.7; // 70% word overlap

// Energy-based speech detection parameters
const ENERGY_FRAME_SIZE = 512; // ~32ms at 16kHz
const ENERGY_THRESHOLD = 0.02;

export class AudioValidator {
  /**
   * Check for audio clipping (samples at or near max amplitude)
   * @param {Float32Array} audio - Audio samples
   * @returns {{ passed: boolean, ratio: number, warning: string|null }}
   */
  static checkClipping(audio) {
    if (!audio || audio.length === 0) {
      return { passed: true, ratio: 0, warning: null };
    }

    let clippedCount = 0;
    for (let i = 0; i < audio.length; i++) {
      if (Math.abs(audio[i]) >= CLIPPING_THRESHOLD) {
        clippedCount++;
      }
    }

    const ratio = clippedCount / audio.length;
    const passed = ratio <= CLIPPING_RATIO_LIMIT;

    return {
      passed,
      ratio,
      warning: !passed
        ? `Audio clipping detected (${(ratio * 100).toFixed(2)}% at max level). Try speaking softer or moving away from the microphone.`
        : null,
    };
  }

  /**
   * Check RMS energy level
   * @param {Float32Array} audio - Audio samples
   * @returns {{ passed: boolean, rms: number, error: string|null }}
   */
  static checkRmsEnergy(audio) {
    if (!audio || audio.length === 0) {
      return { passed: false, rms: 0, error: 'No audio data' };
    }

    let sum = 0;
    for (let i = 0; i < audio.length; i++) {
      sum += audio[i] * audio[i];
    }
    const rms = Math.sqrt(sum / audio.length);

    let error = null;
    if (rms < RMS_MIN) {
      error = 'Audio too quiet. Please speak louder or move closer to the microphone.';
    } else if (rms > RMS_MAX) {
      error = 'Audio too loud or distorted. Please reduce microphone gain or move away.';
    }

    return {
      passed: rms >= RMS_MIN && rms <= RMS_MAX,
      rms,
      error,
    };
  }

  /**
   * Run all audio quality checks
   * @param {Float32Array} audio - Audio samples
   * @returns {{
   *   passed: boolean,
   *   warnings: string[],
   *   errors: string[],
   *   details: { clipping: Object, rms: Object }
   * }}
   */
  static validateAudioQuality(audio) {
    const clipping = this.checkClipping(audio);
    const rms = this.checkRmsEnergy(audio);

    const warnings = [];
    const errors = [];

    // Clipping is a warning (doesn't block enrollment)
    if (clipping.warning) {
      warnings.push(clipping.warning);
    }

    // RMS issues are errors (blocks enrollment)
    if (rms.error) {
      errors.push(rms.error);
    }

    return {
      passed: errors.length === 0,
      warnings,
      errors,
      details: { clipping, rms },
    };
  }

  /**
   * Analyze audio for speech content using simple energy-based detection
   * This is a lightweight alternative to full VAD for enrollment validation
   * @param {Float32Array} audio - Audio samples
   * @param {number} sampleRate - Sample rate (default 16000)
   * @returns {{ speechDuration: number, totalDuration: number, speechRatio: number }}
   */
  static analyzeSpeechContent(audio, sampleRate = 16000) {
    if (!audio || audio.length === 0) {
      return { speechDuration: 0, totalDuration: 0, speechRatio: 0 };
    }

    const totalDuration = audio.length / sampleRate;
    const frames = Math.floor(audio.length / ENERGY_FRAME_SIZE);
    let speechFrames = 0;

    for (let i = 0; i < frames; i++) {
      const start = i * ENERGY_FRAME_SIZE;
      const end = start + ENERGY_FRAME_SIZE;
      let energy = 0;

      for (let j = start; j < end; j++) {
        energy += audio[j] * audio[j];
      }
      energy = Math.sqrt(energy / ENERGY_FRAME_SIZE);

      if (energy > ENERGY_THRESHOLD) {
        speechFrames++;
      }
    }

    const speechDuration = (speechFrames * ENERGY_FRAME_SIZE) / sampleRate;
    const speechRatio = totalDuration > 0 ? speechDuration / totalDuration : 0;

    return {
      speechDuration,
      totalDuration,
      speechRatio,
    };
  }

  /**
   * Validate speech content meets minimum requirements
   * @param {{ speechDuration: number, totalDuration: number, speechRatio: number }} analysis
   * @returns {{ passed: boolean, errors: string[] }}
   */
  static validateSpeechContent(analysis) {
    const errors = [];

    if (analysis.speechDuration < MIN_SPEECH_DURATION) {
      errors.push(
        `Not enough speech detected (${analysis.speechDuration.toFixed(1)}s). Need at least ${MIN_SPEECH_DURATION}s of speech.`
      );
    }

    if (analysis.speechRatio < MIN_SPEECH_RATIO) {
      errors.push(
        `Too much silence (${((1 - analysis.speechRatio) * 100).toFixed(0)}% silence). Please speak more continuously.`
      );
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate transcription matches expected sentence
   * Uses word overlap to account for minor transcription errors
   * @param {string} transcribed - Transcribed text from Whisper
   * @param {string} expected - Expected Rainbow Passage sentence
   * @returns {{ passed: boolean, warnings: string[], matchRatio: number }}
   */
  static validateTranscription(transcribed, expected) {
    const warnings = [];

    // Normalize text: lowercase, remove punctuation, split into words
    const normalizeText = (text) => {
      return (text || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
        .split(' ')
        .filter((w) => w.length > 0);
    };

    const transcribedWords = normalizeText(transcribed);
    const expectedWords = normalizeText(expected);

    // Handle edge cases
    if (transcribedWords.length === 0) {
      return {
        passed: false,
        warnings: ['No speech recognized in recording.'],
        matchRatio: 0,
      };
    }

    if (expectedWords.length === 0) {
      // No expected text provided, skip validation
      return { passed: true, warnings: [], matchRatio: 1 };
    }

    // Check for noise-only transcription
    if (
      transcribedWords.length === 1 &&
      transcribedWords[0].startsWith('[') &&
      transcribedWords[0].endsWith(']')
    ) {
      return {
        passed: false,
        warnings: ['Only noise detected, no speech.'],
        matchRatio: 0,
      };
    }

    // Count matching words (order-independent)
    const transcribedSet = new Set(transcribedWords);
    let matchCount = 0;

    for (const word of expectedWords) {
      if (transcribedSet.has(word)) {
        matchCount++;
      }
    }

    const matchRatio = matchCount / expectedWords.length;
    const passed = matchRatio >= TRANSCRIPTION_MATCH_THRESHOLD;

    if (!passed) {
      if (matchRatio < 0.3) {
        warnings.push(
          `Recording doesn't match expected sentence (${(matchRatio * 100).toFixed(0)}% match). Please read the displayed text.`
        );
      } else if (matchRatio < TRANSCRIPTION_MATCH_THRESHOLD) {
        warnings.push(
          `Partial match (${(matchRatio * 100).toFixed(0)}%). Try reading the sentence more clearly.`
        );
      }
    }

    return {
      passed,
      warnings,
      matchRatio,
    };
  }

  /**
   * Full validation pipeline for enrollment audio
   * @param {Float32Array} audio - Audio samples
   * @param {number} sampleRate - Sample rate
   * @returns {{
   *   audioQuality: Object,
   *   speechContent: Object,
   *   passed: boolean,
   *   errors: string[],
   *   warnings: string[]
   * }}
   */
  static validateEnrollmentAudio(audio, sampleRate = 16000) {
    // Run audio quality checks
    const audioQuality = this.validateAudioQuality(audio);

    // Run speech content analysis
    const speechAnalysis = this.analyzeSpeechContent(audio, sampleRate);
    const speechContent = this.validateSpeechContent(speechAnalysis);

    // Combine results
    const errors = [...audioQuality.errors, ...speechContent.errors];
    const warnings = [...audioQuality.warnings];

    return {
      audioQuality,
      speechContent: {
        ...speechContent,
        ...speechAnalysis,
      },
      passed: errors.length === 0,
      errors,
      warnings,
    };
  }
}
