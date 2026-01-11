/**
 * Word-Segment Mapper
 *
 * Maps Whisper words to acoustic speaker segments, producing phrases
 * that contain both word information and acoustic speaker assignments.
 *
 * This bridges the gap between:
 * - Whisper: produces words with timestamps, no speaker info
 * - Acoustic segmentation: produces speaker boundaries, no word info
 *
 * The result is phrases with words grouped by acoustic speaker ID,
 * which then go through embedding extraction and clustering.
 */

import { PHRASE_DEFAULTS } from '../../config/index.js';

/**
 * @typedef {Object} AcousticSegment
 * @property {number} speakerId - Speaker ID from acoustic model
 * @property {number} start - Start time in seconds
 * @property {number} end - End time in seconds
 * @property {number} confidence - Confidence score
 */

/**
 * @typedef {Object} MappedPhrase
 * @property {Array} words - Whisper word objects
 * @property {number} start - Start time (from first word)
 * @property {number} end - End time (from last word)
 * @property {number} acousticSpeakerId - Speaker ID from acoustic model
 * @property {number} [avgConfidence] - Average confidence from acoustic segments
 */

/**
 * Map words to acoustic segments based on word timing
 *
 * Algorithm:
 * 1. For each word, find which acoustic segment contains its midpoint
 * 2. Group consecutive words with the same acoustic speaker ID
 * 3. Optionally merge very short phrases with neighbors
 *
 * @param {Array} words - Whisper word objects with timestamps
 * @param {AcousticSegment[]} segments - Acoustic segments with speaker IDs
 * @param {Object} [options]
 * @param {number} [options.minPhraseDuration] - Minimum phrase duration in seconds
 * @returns {MappedPhrase[]} Phrases with words and acoustic speaker IDs
 */
export function mapWordsToSegments(words, segments, options = {}) {
  const { minPhraseDuration = PHRASE_DEFAULTS.minPhraseDuration } = options;

  // Handle edge cases
  if (!words || words.length === 0) {
    return [];
  }

  if (!segments || segments.length === 0) {
    // No acoustic segments - treat all words as one phrase with unknown speaker
    const validWords = words.filter(w => w.timestamp && w.timestamp[0] !== null);
    if (validWords.length === 0) return [];

    return [{
      words: validWords,
      start: validWords[0].timestamp[0],
      end: validWords[validWords.length - 1].timestamp[1],
      acousticSpeakerId: -1,
    }];
  }

  // Sort segments by start time for efficient lookup
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  // Assign each word to a segment based on word midpoint
  const wordAssignments = words.map(word => {
    const [wordStart, wordEnd] = word.timestamp || [null, null];

    // Skip words with invalid timestamps
    if (wordStart === null || wordEnd === null) {
      return { word, speakerId: -1, confidence: 0 };
    }

    const wordMid = (wordStart + wordEnd) / 2;

    // Find segment containing word midpoint
    const segment = findSegmentAtTime(sortedSegments, wordMid);

    if (segment) {
      return {
        word,
        speakerId: segment.speakerId,
        confidence: segment.confidence || 1.0,
      };
    }

    // Word is outside all segments (silence region)
    return { word, speakerId: -1, confidence: 0 };
  });

  // Group consecutive words with same speaker into phrases
  const phrases = groupWordsBySpaker(wordAssignments);

  // Merge very short phrases if needed
  return mergeShortPhrases(phrases, minPhraseDuration);
}

/**
 * Find the acoustic segment containing a given time point
 * @param {AcousticSegment[]} segments - Sorted by start time
 * @param {number} time - Time in seconds
 * @returns {AcousticSegment|null}
 */
function findSegmentAtTime(segments, time) {
  // Binary search would be more efficient, but linear is fine for small arrays
  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) {
      return segment;
    }
  }
  return null;
}

/**
 * Group consecutive words with same speaker ID into phrases
 * @param {Array} wordAssignments - [{word, speakerId, confidence}, ...]
 * @returns {MappedPhrase[]}
 */
function groupWordsBySpaker(wordAssignments) {
  const phrases = [];
  let currentPhrase = null;

  for (const { word, speakerId, confidence } of wordAssignments) {
    const [wordStart, wordEnd] = word.timestamp || [null, null];

    // Skip invalid words
    if (wordStart === null || wordEnd === null) {
      continue;
    }

    if (!currentPhrase || currentPhrase.acousticSpeakerId !== speakerId) {
      // Start new phrase
      if (currentPhrase && currentPhrase.words.length > 0) {
        phrases.push(finalizePhrase(currentPhrase));
      }
      currentPhrase = {
        words: [word],
        start: wordStart,
        end: wordEnd,
        acousticSpeakerId: speakerId,
        confidenceSum: confidence,
        confidenceCount: 1,
      };
    } else {
      // Continue current phrase
      currentPhrase.words.push(word);
      currentPhrase.end = wordEnd;
      currentPhrase.confidenceSum += confidence;
      currentPhrase.confidenceCount += 1;
    }
  }

  // Don't forget the last phrase
  if (currentPhrase && currentPhrase.words.length > 0) {
    phrases.push(finalizePhrase(currentPhrase));
  }

  return phrases;
}

/**
 * Finalize a phrase by computing average confidence
 * @param {Object} phrase - Phrase with confidenceSum and confidenceCount
 * @returns {MappedPhrase}
 */
function finalizePhrase(phrase) {
  const { confidenceSum, confidenceCount, ...rest } = phrase;
  return {
    ...rest,
    avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
  };
}

/**
 * Merge phrases that are too short with their neighbors
 *
 * Strategy:
 * - If phrase is shorter than minDuration, merge with previous or next
 * - Prefer merging with neighbor that has same speaker ID
 * - If no same-speaker neighbor, merge with the longer neighbor
 *
 * @param {MappedPhrase[]} phrases
 * @param {number} minDuration - Minimum phrase duration in seconds
 * @returns {MappedPhrase[]}
 */
function mergeShortPhrases(phrases, minDuration) {
  if (phrases.length <= 1) {
    return phrases;
  }

  const result = [];

  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i];
    const duration = phrase.end - phrase.start;

    if (duration >= minDuration) {
      result.push(phrase);
      continue;
    }

    // Phrase is too short - try to merge with previous
    if (result.length > 0) {
      const prev = result[result.length - 1];

      // Merge with previous phrase
      prev.words = [...prev.words, ...phrase.words];
      prev.end = phrase.end;

      // If speakers differ, keep the one with higher confidence
      if (prev.acousticSpeakerId !== phrase.acousticSpeakerId) {
        // Keep the speaker ID from the phrase with more words/confidence
        const prevWordCount = prev.words.length - phrase.words.length;
        if (phrase.words.length > prevWordCount) {
          prev.acousticSpeakerId = phrase.acousticSpeakerId;
        }
      }
    } else {
      // No previous phrase - keep this one even if short
      result.push(phrase);
    }
  }

  return result;
}

/**
 * Debug utility: print word-to-segment mapping
 * @param {Array} words
 * @param {AcousticSegment[]} segments
 * @param {MappedPhrase[]} phrases
 */
export function debugPrintMapping(words, segments, phrases) {
  console.log('=== Word-Segment Mapping Debug ===');
  console.log(`Words: ${words.length}, Segments: ${segments.length}, Phrases: ${phrases.length}`);

  console.log('\nAcoustic Segments:');
  for (const seg of segments) {
    console.log(`  Speaker ${seg.speakerId}: ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s (conf: ${seg.confidence.toFixed(2)})`);
  }

  console.log('\nMapped Phrases:');
  for (const phrase of phrases) {
    const text = phrase.words.map(w => w.text).join('').trim();
    const preview = text.length > 50 ? text.slice(0, 50) + '...' : text;
    console.log(`  Speaker ${phrase.acousticSpeakerId}: ${phrase.start.toFixed(2)}s - ${phrase.end.toFixed(2)}s "${preview}"`);
  }
}
