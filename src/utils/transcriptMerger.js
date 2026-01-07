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
      const text = asrResult.text?.replace(/\[BLANK_AUDIO\]/g, '').trim() || '';
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

    // Process each phrase through speaker clustering
    const processedPhrases = this.speakerClusterer.processPhrases(phrases);

    // Convert phrases to output segments
    for (const phrase of processedPhrases) {
      // Build text from words, filtering out blank audio markers
      const words = (phrase.words || []).filter(
        (w) => !w.text.includes('[BLANK_AUDIO]')
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
   * Add segments to running transcript with overlap deduplication
   */
  addSegments(newSegments) {
    if (!newSegments || newSegments.length === 0) {
      return this.segments;
    }

    // Get the end time of the last existing segment for overlap detection
    const lastEndTime = this.segments.length > 0
      ? this.segments[this.segments.length - 1].endTime
      : 0;

    // Filter out segments that significantly overlap with already-processed content
    // Allow a small tolerance (0.1s) for timing differences
    const tolerance = 0.1;
    const filteredSegments = newSegments.filter((seg) => {
      // Keep segment if it starts after (or very close to) the last processed content
      return seg.startTime >= lastEndTime - tolerance;
    });

    // If the first filtered segment partially overlaps, trim it
    if (filteredSegments.length > 0 && filteredSegments[0].startTime < lastEndTime) {
      const seg = filteredSegments[0];
      // Trim words that fall before lastEndTime
      if (seg.words && seg.words.length > 0) {
        const trimmedWords = seg.words.filter((w) => w.start >= lastEndTime - tolerance);
        if (trimmedWords.length > 0) {
          seg.words = trimmedWords;
          seg.text = trimmedWords.map((w) => w.text).join('');
          seg.startTime = trimmedWords[0].start;
        } else {
          // All words were trimmed, remove this segment
          filteredSegments.shift();
        }
      }
    }

    this.segments.push(...filteredSegments);
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
