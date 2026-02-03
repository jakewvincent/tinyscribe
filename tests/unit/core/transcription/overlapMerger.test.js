/**
 * Unit tests for OverlapMerger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OverlapMerger } from '../../../../src/core/transcription/overlapMerger.js';

// Helper to create a word object with timestamps
function word(text, start, end) {
  return { text, timestamp: [start, end] };
}

describe('OverlapMerger', () => {
  let merger;

  beforeEach(() => {
    merger = new OverlapMerger();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(merger.similarityThreshold).toBe(0.8);
      expect(merger.minMatchLength).toBe(2);
    });

    it('should accept custom options', () => {
      const customMerger = new OverlapMerger({
        similarityThreshold: 0.9,
        minMatchLength: 3,
      });
      expect(customMerger.similarityThreshold).toBe(0.9);
      expect(customMerger.minMatchLength).toBe(3);
    });
  });

  describe('normalizeWord', () => {
    it('should lowercase words', () => {
      expect(merger.normalizeWord('Hello')).toBe('hello');
      expect(merger.normalizeWord('WORLD')).toBe('world');
    });

    it('should remove punctuation', () => {
      expect(merger.normalizeWord('hello,')).toBe('hello');
      expect(merger.normalizeWord("don't")).toBe('dont');
      expect(merger.normalizeWord('end.')).toBe('end');
    });

    it('should trim whitespace', () => {
      expect(merger.normalizeWord('  hello  ')).toBe('hello');
    });

    it('should handle empty or null input', () => {
      expect(merger.normalizeWord('')).toBe('');
      expect(merger.normalizeWord(null)).toBe('');
      expect(merger.normalizeWord(undefined)).toBe('');
    });
  });

  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(merger.levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return string length for empty comparison', () => {
      expect(merger.levenshteinDistance('hello', '')).toBe(5);
      expect(merger.levenshteinDistance('', 'world')).toBe(5);
    });

    it('should calculate single character difference', () => {
      expect(merger.levenshteinDistance('cat', 'hat')).toBe(1);
      expect(merger.levenshteinDistance('cat', 'car')).toBe(1);
    });

    it('should calculate insertions', () => {
      expect(merger.levenshteinDistance('cat', 'cats')).toBe(1);
      expect(merger.levenshteinDistance('go', 'going')).toBe(3);
    });

    it('should calculate deletions', () => {
      expect(merger.levenshteinDistance('hello', 'helo')).toBe(1);
    });

    it('should handle completely different strings', () => {
      expect(merger.levenshteinDistance('abc', 'xyz')).toBe(3);
    });
  });

  describe('fuzzyMatch', () => {
    it('should return true for exact matches', () => {
      expect(merger.fuzzyMatch('hello', 'hello')).toBe(true);
    });

    it('should return true when one is substring of other', () => {
      expect(merger.fuzzyMatch('going', 'goin')).toBe(true);
      expect(merger.fuzzyMatch('goin', 'going')).toBe(true);
    });

    it('should return true for similar words (>= 75% similarity)', () => {
      expect(merger.fuzzyMatch('hello', 'hallo')).toBe(true); // 1 diff in 5 = 80%
    });

    it('should return false for dissimilar words', () => {
      expect(merger.fuzzyMatch('hello', 'world')).toBe(false);
      expect(merger.fuzzyMatch('cat', 'dog')).toBe(false);
    });

    it('should handle empty or null input', () => {
      expect(merger.fuzzyMatch('', 'hello')).toBe(false);
      expect(merger.fuzzyMatch('hello', '')).toBe(false);
      expect(merger.fuzzyMatch(null, 'hello')).toBe(false);
      expect(merger.fuzzyMatch('hello', null)).toBe(false);
    });
  });

  describe('calculateSequenceSimilarity', () => {
    it('should return 1 for identical sequences', () => {
      expect(merger.calculateSequenceSimilarity(['hello', 'world'], ['hello', 'world'])).toBe(1);
    });

    it('should return 0 for different length sequences', () => {
      expect(merger.calculateSequenceSimilarity(['hello'], ['hello', 'world'])).toBe(0);
    });

    it('should return 0 for empty sequences', () => {
      expect(merger.calculateSequenceSimilarity([], [])).toBe(0);
    });

    it('should return 0 for completely different sequences', () => {
      expect(merger.calculateSequenceSimilarity(['a', 'b'], ['x', 'y'])).toBe(0);
    });

    it('should give partial credit for fuzzy matches', () => {
      const similarity = merger.calculateSequenceSimilarity(['going', 'to'], ['goin', 'to']);
      expect(similarity).toBeGreaterThan(0.8); // 0.8 + 1 / 2 = 0.9
      expect(similarity).toBeLessThan(1);
    });

    it('should handle mixed matches', () => {
      const similarity = merger.calculateSequenceSimilarity(
        ['hello', 'world', 'test'],
        ['hello', 'earth', 'test']
      );
      expect(similarity).toBeCloseTo(2 / 3, 2); // 2 exact matches out of 3
    });
  });

  describe('getOverlapWordsFromEnd', () => {
    it('should return empty for empty input', () => {
      expect(merger.getOverlapWordsFromEnd([], 1.5)).toEqual([]);
    });

    it('should return words within overlap duration from end', () => {
      const words = [
        word('first', 0, 0.5),
        word('second', 1, 1.5),
        word('third', 2, 2.5),
        word('fourth', 3, 3.5),
      ];
      // End time is 3.5, overlap of 1.5 means words starting >= 2.0
      const result = merger.getOverlapWordsFromEnd(words, 1.5);
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('third');
      expect(result[1].text).toBe('fourth');
    });

    it('should return all words if overlap covers entire chunk', () => {
      const words = [word('one', 0, 0.5), word('two', 0.5, 1)];
      const result = merger.getOverlapWordsFromEnd(words, 10);
      expect(result.length).toBe(2);
    });
  });

  describe('getOverlapWordsFromStart', () => {
    it('should return empty for empty input', () => {
      expect(merger.getOverlapWordsFromStart([], 1.5)).toEqual([]);
    });

    it('should return words starting within overlap duration', () => {
      const words = [
        word('first', 0, 0.5),
        word('second', 0.8, 1.2),
        word('third', 1.4, 1.8),
        word('fourth', 2, 2.5),
      ];
      // Overlap of 1.5 means words starting < 1.5
      const result = merger.getOverlapWordsFromStart(words, 1.5);
      expect(result.length).toBe(3);
      expect(result[0].text).toBe('first');
      expect(result[1].text).toBe('second');
      expect(result[2].text).toBe('third');
    });

    it('should include word that starts in overlap even if it extends past', () => {
      const words = [word('long', 1, 3)]; // Starts at 1, ends at 3
      const result = merger.getOverlapWordsFromStart(words, 1.5);
      expect(result.length).toBe(1);
    });
  });

  describe('adjustTimestamps', () => {
    it('should subtract overlap duration from all timestamps', () => {
      const words = [word('first', 1.5, 2), word('second', 2.5, 3)];
      const adjusted = merger.adjustTimestamps(words, 1.5);

      expect(adjusted[0].timestamp).toEqual([0, 0.5]);
      expect(adjusted[1].timestamp).toEqual([1, 1.5]);
    });

    it('should clamp negative timestamps to 0', () => {
      const words = [word('early', 0.5, 1)];
      const adjusted = merger.adjustTimestamps(words, 1.5);

      expect(adjusted[0].timestamp).toEqual([0, 0]);
    });

    it('should preserve words without timestamps', () => {
      const words = [{ text: 'no-timestamp' }];
      const adjusted = merger.adjustTimestamps(words, 1.5);

      expect(adjusted[0].text).toBe('no-timestamp');
      expect(adjusted[0].timestamp).toBeUndefined();
    });

    it('should preserve other word properties', () => {
      const words = [{ text: 'test', timestamp: [2, 3], extra: 'data' }];
      const adjusted = merger.adjustTimestamps(words, 1);

      expect(adjusted[0].extra).toBe('data');
      expect(adjusted[0].text).toBe('test');
    });
  });

  describe('findMergePoint', () => {
    it('should return no_overlap for empty previous words', () => {
      const result = merger.findMergePoint([], [word('test', 0, 1)], 1.5);
      expect(result.method).toBe('no_overlap');
      expect(result.mergeIndex).toBe(0);
      expect(result.confidence).toBe(1.0);
    });

    it('should return no_overlap for empty current words', () => {
      const result = merger.findMergePoint([word('test', 0, 1)], [], 1.5);
      expect(result.method).toBe('no_overlap');
      expect(result.mergeIndex).toBe(0);
    });

    it('should return no_overlap for null inputs', () => {
      const result = merger.findMergePoint(null, [word('test', 0, 1)], 1.5);
      expect(result.method).toBe('no_overlap');
    });

    it('should return no_overlap for zero overlap duration', () => {
      const prev = [word('hello', 0, 1)];
      const curr = [word('world', 0, 1)];
      const result = merger.findMergePoint(prev, curr, 0);
      expect(result.method).toBe('no_overlap');
    });

    it('should find text match when words overlap', () => {
      // Previous chunk ends with "hello world"
      const prev = [
        word('the', 0, 0.5),
        word('hello', 1, 1.5),
        word('world', 1.5, 2),
      ];
      // Current chunk starts with "hello world" then continues
      const curr = [
        word('hello', 0, 0.5),
        word('world', 0.5, 1),
        word('is', 1, 1.3),
        word('great', 1.3, 1.8),
      ];

      const result = merger.findMergePoint(prev, curr, 1.5);

      expect(result.method).toBe('text_match');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.mergeIndex).toBe(2); // Skip "hello" and "world", start from "is"
    });

    it('should fall back to no_text_match when words do not match', () => {
      const prev = [word('completely', 0, 0.5), word('different', 0.5, 1)];
      const curr = [word('unrelated', 0, 0.5), word('content', 0.5, 1)];

      const result = merger.findMergePoint(prev, curr, 1.5);

      expect(result.method).toBe('no_text_match');
      expect(result.mergeIndex).toBe(0); // Keep all words (safe default)
      expect(result.confidence).toBe(0);
    });

    it('should handle partial matches below threshold', () => {
      // Only 1 word matches but minMatchLength is 2
      const prev = [word('hello', 0, 0.5), word('world', 0.5, 1)];
      const curr = [word('hello', 0, 0.5), word('universe', 0.5, 1)];

      const result = merger.findMergePoint(prev, curr, 1.5);

      // Should fall back since only 1 word matches exactly
      expect(result.confidence).toBeLessThan(1);
    });
  });

  describe('integration: real transcription scenarios', () => {
    it('should handle typical Whisper overlap pattern', () => {
      // Simulates: chunk 1 ends "...going to the store"
      //            chunk 2 starts "to the store and then..."
      const prevChunk = [
        word('I', 0, 0.2),
        word('am', 0.3, 0.5),
        word('going', 0.6, 0.9),
        word('to', 1.0, 1.1),
        word('the', 1.2, 1.3),
        word('store', 1.4, 1.8),
      ];

      const currChunk = [
        word('to', 0, 0.1),
        word('the', 0.1, 0.2),
        word('store', 0.2, 0.5),
        word('and', 0.6, 0.7),
        word('then', 0.8, 1.0),
        word('home', 1.1, 1.4),
      ];

      const result = merger.findMergePoint(prevChunk, currChunk, 1.5);

      expect(result.method).toBe('text_match');
      expect(result.mergeIndex).toBe(3); // After "to the store", start from "and"
    });

    it('should handle punctuation differences gracefully', () => {
      const prev = [word('Hello,', 0, 0.5), word('world!', 0.5, 1)];
      const curr = [word('hello', 0, 0.5), word('world', 0.5, 1), word('test', 1, 1.5)];

      const result = merger.findMergePoint(prev, curr, 1.5);

      expect(result.method).toBe('text_match');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should handle case differences gracefully', () => {
      const prev = [word('HELLO', 0, 0.5), word('World', 0.5, 1)];
      const curr = [word('hello', 0, 0.5), word('world', 0.5, 1), word('test', 1, 1.5)];

      const result = merger.findMergePoint(prev, curr, 1.5);

      expect(result.method).toBe('text_match');
    });
  });
});
