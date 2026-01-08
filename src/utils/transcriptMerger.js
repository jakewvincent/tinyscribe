/**
 * Transcript Merger
 * Processes phrases with embeddings and assigns speakers via clustering
 */

import { SpeakerClusterer } from './speakerClusterer.js';

// Human voice sounds - can be attributed to a speaker
const HUMAN_VOICE_PATTERNS = [
  'laugh', 'chuckle', 'giggle', 'cough', 'sigh', 'sneeze', 'cry', 'sob',
  'scream', 'groan', 'moan', 'yawn', 'gasp', 'breath', 'hum', 'whistle',
  'sing', 'clear', 'throat', 'hiccup', 'snore', 'sniff', 'whimper',
];

// Environmental sounds - should NOT be attributed to a speaker
const ENVIRONMENTAL_PATTERNS = [
  'blank', 'music', 'noise', 'applause', 'silence', 'static', 'beep',
  'ring', 'click', 'bang', 'crash', 'thunder', 'rain', 'wind', 'door',
  'phone', 'alarm', 'siren', 'horn', 'engine', 'background',
];

export class TranscriptMerger {
  constructor(numSpeakers = 2) {
    this.segments = [];
    this.speakerClusterer = new SpeakerClusterer(numSpeakers);
  }

  /**
   * Set the expected number of speakers
   */
  setNumSpeakers(n) {
    this.speakerClusterer.setNumSpeakers(n);
  }

  /**
   * Check if text is a bracketed marker like [MUSIC] or [LAUGHTER]
   */
  isBracketedMarker(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^\[.*\]$/.test(trimmed) || /^\(.*\)$/.test(trimmed);
  }

  /**
   * Check if text is a human voice sound (can be attributed to speaker)
   */
  isHumanVoiceSound(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return HUMAN_VOICE_PATTERNS.some((pattern) => lower.includes(pattern));
  }

  /**
   * Check if text is an environmental sound (should NOT be attributed to speaker)
   * Default: unknown bracketed markers are treated as environmental (safer)
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
   */
  isBlankAudio(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^\[BLANK/i.test(trimmed) || /^AUDIO\]$/i.test(trimmed);
  }

  /**
   * Check if phrase contains only BLANK_AUDIO (should be excluded entirely)
   */
  isBlankAudioOnly(phrase) {
    if (!phrase.words || phrase.words.length === 0) return true;
    return phrase.words.every((w) => this.isBlankAudio(w.text));
  }

  /**
   * Check if phrase contains only environmental sounds (no speech)
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
   * Merge ASR results with phrase-based diarization
   * @param {Object} asrResult - Whisper output with text
   * @param {Array} phrases - Phrases from PhraseDetector with words, start, end, embedding
   * @param {number} chunkStartTime - Start time offset for this audio chunk
   * @returns {Array} Merged segments with speaker labels and text
   */
  merge(asrResult, phrases, chunkStartTime = 0) {
    const result = [];

    // Handle case with no phrases
    if (!phrases || phrases.length === 0) {
      // Fall back to full transcript as single segment
      // Remove blank audio markers (various formats)
      const text = asrResult.text?.replace(/\[BLANK[_\s]*AUDIO\]/gi, '').trim() || '';
      if (text) {
        const speakerId = this.speakerClusterer.assignSpeaker(null);
        return [{
          speaker: speakerId,
          speakerLabel: this.speakerClusterer.getSpeakerLabel(speakerId),
          text,
          startTime: chunkStartTime,
          endTime: chunkStartTime + (asrResult.chunks?.length > 0
            ? (asrResult.chunks[asrResult.chunks.length - 1].timestamp?.[1] || 0)
            : 0),
          words: [],
        }];
      }
      return result;
    }

    // Categorize phrases:
    // 1. BLANK_AUDIO only → filter out entirely
    // 2. Environmental only (music, applause, etc.) → show without speaker
    // 3. Speech/human sounds → normal speaker clustering
    const speechPhrases = [];
    const environmentalPhrases = [];

    for (const phrase of phrases) {
      if (this.isBlankAudioOnly(phrase)) {
        // Filter out completely - silence/blank audio
        continue;
      } else if (this.isEnvironmentalOnly(phrase)) {
        // Environmental sound - keep but don't attribute to speaker
        environmentalPhrases.push(phrase);
      } else {
        // Speech or human voice sounds - cluster normally
        speechPhrases.push(phrase);
      }
    }

    // Process speech phrases through speaker clustering
    const processedSpeechPhrases = this.speakerClusterer.processPhrases(speechPhrases);

    // Convert speech phrases to output segments
    for (const phrase of processedSpeechPhrases) {
      // Filter out BLANK_AUDIO tokens but keep other markers (human sounds)
      const words = (phrase.words || []).filter(
        (w) => !this.isBlankAudio(w.text)
      );

      if (words.length === 0) continue;

      const text = words.map((w) => w.text).join('');
      const duration = phrase.end - phrase.start;

      result.push({
        speaker: phrase.clusteredSpeakerId,
        speakerLabel: this.speakerClusterer.getSpeakerLabel(phrase.clusteredSpeakerId),
        text,
        startTime: chunkStartTime + phrase.start,
        endTime: chunkStartTime + phrase.end,
        words: words.map((w) => ({
          text: w.text,
          start: chunkStartTime + (w.timestamp?.[0] || phrase.start),
          end: chunkStartTime + (w.timestamp?.[1] || phrase.end),
        })),
        // Debug info for phrase stats panel
        debug: {
          duration: duration,
          frameCount: phrase.frameCount || 0,
          type: 'speech',
          clustering: phrase.clusteringDebug || null,
        },
      });
    }

    // Convert environmental phrases to segments without speaker attribution
    for (const phrase of environmentalPhrases) {
      const words = (phrase.words || []).filter((w) => w.text?.trim());
      if (words.length === 0) continue;

      const text = words.map((w) => w.text).join('');
      const duration = phrase.end - phrase.start;

      result.push({
        speaker: null,
        speakerLabel: null,
        text,
        startTime: chunkStartTime + phrase.start,
        endTime: chunkStartTime + phrase.end,
        isEnvironmental: true,
        words: words.map((w) => ({
          text: w.text,
          start: chunkStartTime + (w.timestamp?.[0] || phrase.start),
          end: chunkStartTime + (w.timestamp?.[1] || phrase.end),
        })),
        // Debug info for environmental sounds
        debug: {
          duration: duration,
          frameCount: phrase.frameCount || 0,
          type: 'environmental',
          clustering: null,
        },
      });
    }

    // Sort by start time to maintain chronological order
    result.sort((a, b) => a.startTime - b.startTime);

    return result;
  }

  /**
   * Reset for new recording session
   * @param {boolean} preserveEnrolled - If true, keeps enrolled speaker
   */
  reset(preserveEnrolled = true) {
    this.segments = [];
    this.speakerClusterer.reset(preserveEnrolled);
  }

  /**
   * Add segments to running transcript
   * (Deduplication no longer needed - carryover-based chunking prevents duplicates)
   */
  addSegments(newSegments) {
    if (!newSegments || newSegments.length === 0) {
      return this.segments;
    }
    this.segments.push(...newSegments);
    return this.segments;
  }

  /**
   * Get all segments
   */
  getTranscript() {
    return this.segments;
  }

  /**
   * Format time as M:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Export transcript as plain text
   */
  exportAsText() {
    return this.segments
      .map((seg) => {
        const timeRange = `[${this.formatTime(seg.startTime)} - ${this.formatTime(seg.endTime)}]`;
        if (seg.isEnvironmental || seg.speaker === null) {
          return `${timeRange}: ${seg.text.trim()}`;
        }
        return `${seg.speakerLabel} ${timeRange}: ${seg.text.trim()}`;
      })
      .join('\n');
  }

  /**
   * Export transcript as JSON
   */
  exportAsJSON() {
    return JSON.stringify(this.segments, null, 2);
  }

  /**
   * Get unique speakers in the transcript
   */
  getSpeakers() {
    const speakers = new Set();
    for (const segment of this.segments) {
      speakers.add(segment.speaker);
    }
    return Array.from(speakers).map((id) => ({
      id,
      label: this.speakerClusterer.getSpeakerLabel(id),
    }));
  }
}
