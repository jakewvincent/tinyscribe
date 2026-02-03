/**
 * Unit tests for PhraseDetector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PhraseDetector } from '../../../../src/core/transcription/phraseDetector.js';

// Helper to create a word/chunk object
function word(text, start, end) {
  return { text, timestamp: [start, end] };
}

// Helper to create mock frame features tensor
function createFrameFeatures(numFrames, hiddenDim, fillValue = 1.0) {
  const data = new Float32Array(numFrames * hiddenDim);
  for (let i = 0; i < data.length; i++) {
    data[i] = fillValue;
  }
  return {
    dims: [1, numFrames, hiddenDim],
    data,
  };
}

describe('PhraseDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new PhraseDetector();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(detector.gapThreshold).toBe(0.2);
      expect(detector.minPhraseDuration).toBe(0.5);
      expect(detector.frameRate).toBe(50);
    });

    it('should accept custom options', () => {
      const customDetector = new PhraseDetector({
        gapThreshold: 0.5,
        minPhraseDuration: 1.0,
        frameRate: 100,
      });
      expect(customDetector.gapThreshold).toBe(0.5);
      expect(customDetector.minPhraseDuration).toBe(1.0);
      expect(customDetector.frameRate).toBe(100);
    });
  });

  describe('detectPhrases', () => {
    it('should return empty array for null input', () => {
      expect(detector.detectPhrases(null)).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      expect(detector.detectPhrases([])).toEqual([]);
    });

    it('should create single phrase for single word', () => {
      const chunks = [word('hello', 0, 0.5)];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(1);
      expect(phrases[0].words.length).toBe(1);
      expect(phrases[0].start).toBe(0);
      expect(phrases[0].end).toBe(0.5);
    });

    it('should keep continuous words in same phrase', () => {
      // Words with small gaps (< 0.2s threshold)
      const chunks = [
        word(' Hello', 0, 0.3),
        word(' world', 0.35, 0.6), // 0.05s gap
        word(' test', 0.65, 0.9), // 0.05s gap
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(1);
      expect(phrases[0].words.length).toBe(3);
      expect(phrases[0].start).toBe(0);
      expect(phrases[0].end).toBe(0.9);
    });

    it('should split phrases on gaps >= threshold', () => {
      // Default threshold is 0.2s
      const chunks = [
        word(' Hello', 0, 0.3),
        word(' world', 0.35, 0.6), // 0.05s gap - same phrase
        word(' new', 1.0, 1.2), // 0.4s gap - new phrase
        word(' phrase', 1.25, 1.5), // 0.05s gap - same phrase
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(2);
      expect(phrases[0].words.length).toBe(2);
      expect(phrases[0].start).toBe(0);
      expect(phrases[0].end).toBe(0.6);
      expect(phrases[1].words.length).toBe(2);
      expect(phrases[1].start).toBe(1.0);
      expect(phrases[1].end).toBe(1.5);
    });

    it('should handle gap slightly above threshold', () => {
      // Gap just above threshold should trigger new phrase
      const chunks = [
        word(' Hello', 0, 0.5),
        word(' world', 0.71, 1.0), // 0.21s gap - just above 0.2s threshold
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(2);
    });

    it('should keep phrase together for gap below threshold', () => {
      const chunks = [
        word(' Hello', 0, 0.5),
        word(' world', 0.69, 1.0), // 0.19s gap - below 0.2s threshold
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(1);
    });

    it('should skip words with null timestamps', () => {
      const chunks = [
        word(' Hello', 0, 0.3),
        { text: ' invalid', timestamp: [null, null] },
        word(' world', 0.35, 0.6),
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(1);
      expect(phrases[0].words.length).toBe(2);
      expect(phrases[0].words[0].text).toBe(' Hello');
      expect(phrases[0].words[1].text).toBe(' world');
    });

    it('should handle multiple phrase breaks', () => {
      const chunks = [
        word('a', 0, 0.1),
        word('b', 0.5, 0.6), // 0.4s gap - break
        word('c', 1.0, 1.1), // 0.4s gap - break
        word('d', 1.5, 1.6), // 0.4s gap - break
      ];
      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(4);
      phrases.forEach((phrase, i) => {
        expect(phrase.words.length).toBe(1);
      });
    });

    it('should work with custom gap threshold', () => {
      const customDetector = new PhraseDetector({ gapThreshold: 0.5 });
      const chunks = [
        word(' Hello', 0, 0.3),
        word(' world', 0.6, 0.9), // 0.3s gap - below 0.5 threshold
        word(' new', 1.5, 1.8), // 0.6s gap - above threshold
      ];
      const phrases = customDetector.detectPhrases(chunks);

      expect(phrases.length).toBe(2);
      expect(phrases[0].words.length).toBe(2);
      expect(phrases[1].words.length).toBe(1);
    });
  });

  describe('extractPhraseEmbeddings', () => {
    it('should return null embeddings for invalid frame features', () => {
      const phrases = [{ words: [word('test', 0, 1)], start: 0, end: 1 }];

      const result = detector.extractPhraseEmbeddings(null, phrases, 2);
      expect(result[0].embedding).toBeNull();

      const result2 = detector.extractPhraseEmbeddings({}, phrases, 2);
      expect(result2[0].embedding).toBeNull();
    });

    it('should return null for phrases shorter than minPhraseDuration', () => {
      // Default minPhraseDuration is 0.5s
      const features = createFrameFeatures(100, 16);
      const phrases = [{ words: [word('hi', 0, 0.3)], start: 0, end: 0.3 }]; // 0.3s < 0.5s

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result[0].embedding).toBeNull();
      expect(result[0].reason).toBe('too_short');
    });

    it('should extract embeddings for valid phrases', () => {
      // 100 frames over 2 seconds = 50 fps
      const features = createFrameFeatures(100, 16, 2.0);
      const phrases = [{ words: [word('hello', 0, 1)], start: 0, end: 1 }]; // 1s duration

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result[0].embedding).toBeInstanceOf(Float32Array);
      expect(result[0].embedding.length).toBe(16);
      // All values should be 2.0 (mean of constant 2.0 values)
      expect(result[0].embedding[0]).toBeCloseTo(2.0, 5);
    });

    it('should mean pool frames correctly', () => {
      const numFrames = 100;
      const hiddenDim = 4;
      const data = new Float32Array(numFrames * hiddenDim);

      // Fill frames 0-49 with value 1, frames 50-99 with value 3
      for (let f = 0; f < numFrames; f++) {
        const value = f < 50 ? 1 : 3;
        for (let d = 0; d < hiddenDim; d++) {
          data[f * hiddenDim + d] = value;
        }
      }

      const features = { dims: [1, numFrames, hiddenDim], data };
      // Phrase covers frames 0-49 (first half)
      const phrases = [{ words: [word('test', 0, 1)], start: 0, end: 1 }];

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      // Should be mean of first 50 frames = 1.0
      expect(result[0].embedding[0]).toBeCloseTo(1.0, 5);
    });

    it('should handle phrase at end of audio', () => {
      const features = createFrameFeatures(100, 8, 1.0);
      const phrases = [{ words: [word('end', 1.5, 2)], start: 1.5, end: 2 }];

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result[0].embedding).toBeInstanceOf(Float32Array);
      expect(result[0].frameCount).toBeGreaterThan(0);
    });

    it('should return null when no frames in phrase range', () => {
      const features = createFrameFeatures(10, 8, 1.0);
      // Phrase is beyond the frame range
      const phrases = [{ words: [word('test', 10, 11)], start: 10, end: 11 }];

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result[0].embedding).toBeNull();
      expect(result[0].reason).toBe('no_frames');
    });

    it('should process multiple phrases independently', () => {
      const features = createFrameFeatures(100, 4, 1.0);
      const phrases = [
        { words: [word('first', 0, 0.8)], start: 0, end: 0.8 },
        { words: [word('second', 1, 1.8)], start: 1, end: 1.8 },
      ];

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result.length).toBe(2);
      expect(result[0].embedding).toBeInstanceOf(Float32Array);
      expect(result[1].embedding).toBeInstanceOf(Float32Array);
    });

    it('should preserve original phrase properties', () => {
      const features = createFrameFeatures(100, 4, 1.0);
      const phrases = [
        {
          words: [word('test', 0, 1)],
          start: 0,
          end: 1,
          customProp: 'preserved',
        },
      ];

      const result = detector.extractPhraseEmbeddings(features, phrases, 2);

      expect(result[0].customProp).toBe('preserved');
      expect(result[0].words).toEqual(phrases[0].words);
    });
  });

  describe('getPhraseText', () => {
    it('should join word texts', () => {
      const phrase = {
        words: [word(' Hello', 0, 0.3), word(' world', 0.4, 0.7)],
        start: 0,
        end: 0.7,
      };

      expect(detector.getPhraseText(phrase)).toBe('Hello world');
    });

    it('should handle single word', () => {
      const phrase = {
        words: [word('Hello', 0, 0.3)],
        start: 0,
        end: 0.3,
      };

      expect(detector.getPhraseText(phrase)).toBe('Hello');
    });

    it('should trim whitespace', () => {
      const phrase = {
        words: [word('  Hello  ', 0, 0.3)],
        start: 0,
        end: 0.3,
      };

      expect(detector.getPhraseText(phrase)).toBe('Hello');
    });

    it('should handle empty words array', () => {
      const phrase = { words: [], start: 0, end: 0 };
      expect(detector.getPhraseText(phrase)).toBe('');
    });
  });

  describe('integration: realistic transcription flow', () => {
    it('should detect phrases from typical Whisper output', () => {
      // Simulates Whisper output with natural pauses
      const chunks = [
        word(' The', 0.0, 0.15),
        word(' quick', 0.16, 0.4),
        word(' brown', 0.42, 0.7),
        word(' fox', 0.72, 1.0),
        // 0.5s pause
        word(' jumps', 1.5, 1.8),
        word(' over', 1.82, 2.1),
        word(' the', 2.12, 2.3),
        word(' lazy', 2.32, 2.6),
        word(' dog', 2.62, 2.9),
      ];

      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(2);
      expect(detector.getPhraseText(phrases[0])).toBe('The quick brown fox');
      expect(detector.getPhraseText(phrases[1])).toBe('jumps over the lazy dog');
    });

    it('should handle conversation with multiple speakers (gaps between turns)', () => {
      const chunks = [
        // Speaker 1
        word(' Hello', 0, 0.3),
        word(' there', 0.32, 0.5),
        // 1s gap (speaker change)
        // Speaker 2
        word(' Hi', 1.5, 1.7),
        word(' how', 1.72, 1.9),
        word(' are', 1.92, 2.0),
        word(' you', 2.02, 2.2),
        // 0.8s gap (speaker change)
        // Speaker 1
        word(' Good', 3.0, 3.2),
        word(' thanks', 3.22, 3.5),
      ];

      const phrases = detector.detectPhrases(chunks);

      expect(phrases.length).toBe(3);
      expect(detector.getPhraseText(phrases[0])).toBe('Hello there');
      expect(detector.getPhraseText(phrases[1])).toBe('Hi how are you');
      expect(detector.getPhraseText(phrases[2])).toBe('Good thanks');
    });
  });
});
