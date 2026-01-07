/**
 * Transcript Merger
 * Processes phrases with embeddings and assigns speakers via clustering
 */

import { SpeakerClusterer } from './speakerClusterer.js';

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
   * Check if text is a non-speech marker that should be excluded
   */
  isNonSpeechMarker(text) {
    if (!text) return true;
    const trimmed = text.trim();
    // Match [BLANK_AUDIO], [BLANK AUDIO], [BLANK, AUDIO], etc.
    return /^\[BLANK/i.test(trimmed) || /^AUDIO\]$/i.test(trimmed);
  }

  /**
   * Check if phrase contains only BLANK_AUDIO (should be excluded entirely)
   */
  isBlankAudioOnly(phrase) {
    if (!phrase.words || phrase.words.length === 0) return true;
    // Check if ALL words are blank/non-speech markers
    return phrase.words.every((w) => this.isNonSpeechMarker(w.text));
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

    // Filter out BLANK_AUDIO-only phrases BEFORE speaker clustering
    // This prevents silence embeddings from affecting speaker assignment
    const speechPhrases = phrases.filter((p) => !this.isBlankAudioOnly(p));

    // Process only speech phrases through speaker clustering
    const processedPhrases = this.speakerClusterer.processPhrases(speechPhrases);

    // Convert phrases to output segments
    for (const phrase of processedPhrases) {
      // Filter out any remaining non-speech markers (in case of mixed phrases)
      const words = (phrase.words || []).filter(
        (w) => !this.isNonSpeechMarker(w.text)
      );

      if (words.length === 0) continue;

      const text = words.map((w) => w.text).join('');

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
      });
    }

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
      .map((seg) => `${seg.speakerLabel} [${this.formatTime(seg.startTime)} - ${this.formatTime(seg.endTime)}]: ${seg.text.trim()}`)
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
