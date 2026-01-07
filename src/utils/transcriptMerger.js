/**
 * Transcript Merger
 * Aligns ASR word timestamps with speaker diarization segments
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
   * Merge ASR results with diarization segments
   * @param {Object} asrResult - Whisper output with chunks (words + timestamps)
   * @param {Array} diarizationSegments - Pyannote segments with start, end, speaker, embedding
   * @param {number} chunkStartTime - Start time offset for this audio chunk
   * @returns {Array} Merged segments with speaker labels and text
   */
  merge(asrResult, diarizationSegments, chunkStartTime = 0) {
    let words = asrResult.chunks || [];
    const result = [];

    // Filter out [BLANK_AUDIO] tokens
    words = words.filter((w) => !w.text.includes('[BLANK_AUDIO]'));

    // Handle case with no words
    if (!words.length) {
      return result;
    }

    // Process diarization segments through speaker clusterer to get consistent IDs
    const processedSegments = diarizationSegments && diarizationSegments.length
      ? this.speakerClusterer.processSegments(diarizationSegments)
      : [];

    // Handle case with no diarization - treat as single speaker
    if (!processedSegments.length) {
      const speakerId = this.speakerClusterer.assignSpeaker(null);
      return [{
        speaker: speakerId,
        speakerLabel: this.speakerClusterer.getSpeakerLabel(speakerId),
        text: asrResult.text?.replace(/\[BLANK_AUDIO\]/g, '').trim() || '',
        startTime: chunkStartTime + (words[0]?.timestamp?.[0] || 0),
        endTime: chunkStartTime + (words[words.length - 1]?.timestamp?.[1] || 0),
        words: words.map((w) => ({
          text: w.text,
          start: chunkStartTime + (w.timestamp?.[0] || 0),
          end: chunkStartTime + (w.timestamp?.[1] || 0),
        })),
      }];
    }

    // Group words by speaker segments
    let currentSegment = null;
    let currentWords = [];
    let lastSpeakerId = null;

    for (const word of words) {
      // Get word timing (handle both array and object formats)
      const wordStart = Array.isArray(word.timestamp)
        ? word.timestamp[0]
        : word.timestamp?.start || 0;
      const wordEnd = Array.isArray(word.timestamp)
        ? word.timestamp[1]
        : word.timestamp?.end || wordStart;
      const wordMid = (wordStart + wordEnd) / 2;

      // Find which diarization segment this word belongs to
      const speakerSegment = processedSegments.find(
        (seg) => seg.start <= wordMid && wordMid < seg.end
      );

      // Use clustered speaker ID for consistent identification
      const speakerId = speakerSegment?.clusteredSpeakerId ?? 0;

      // Start new segment if speaker changed or first word
      if (currentSegment === null || lastSpeakerId !== speakerId) {
        // Finalize previous segment
        if (currentSegment !== null && currentWords.length > 0) {
          currentSegment.text = currentWords.map((w) => w.text).join('');
          currentSegment.endTime = currentWords[currentWords.length - 1].end;
          currentSegment.words = [...currentWords];
          result.push(currentSegment);
        }

        // Start new segment
        currentSegment = {
          speaker: speakerId,
          speakerLabel: this.speakerClusterer.getSpeakerLabel(speakerId),
          startTime: chunkStartTime + wordStart,
          endTime: 0,
          text: '',
          words: [],
        };
        currentWords = [];
        lastSpeakerId = speakerId;
      }

      // Add word to current segment
      currentWords.push({
        text: word.text,
        start: chunkStartTime + wordStart,
        end: chunkStartTime + wordEnd,
      });
    }

    // Finalize last segment
    if (currentSegment !== null && currentWords.length > 0) {
      currentSegment.text = currentWords.map((w) => w.text).join('');
      currentSegment.endTime = currentWords[currentWords.length - 1].end;
      currentSegment.words = currentWords;
      result.push(currentSegment);
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
