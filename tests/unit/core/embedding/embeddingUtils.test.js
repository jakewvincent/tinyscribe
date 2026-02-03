/**
 * Unit tests for embedding utilities
 */

import { describe, it, expect } from 'vitest';
import { l2Normalize, l2NormalizeCopy, cosineSimilarity } from '../../../../src/core/embedding/embeddingUtils.js';

describe('embeddingUtils', () => {
  describe('l2Normalize', () => {
    it('should normalize vector to unit length in place', () => {
      const vec = new Float32Array([3, 4]); // 3-4-5 triangle
      l2Normalize(vec);

      const norm = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1]);
      expect(norm).toBeCloseTo(1, 5);
      expect(vec[0]).toBeCloseTo(0.6, 5);
      expect(vec[1]).toBeCloseTo(0.8, 5);
    });

    it('should handle zero vector', () => {
      const vec = new Float32Array([0, 0, 0]);
      l2Normalize(vec);

      // Should remain zero (or handle gracefully)
      expect(vec[0]).toBe(0);
    });

    it('should handle already normalized vector', () => {
      const vec = new Float32Array([1, 0, 0]);
      l2Normalize(vec);

      expect(vec[0]).toBeCloseTo(1, 5);
      expect(vec[1]).toBeCloseTo(0, 5);
      expect(vec[2]).toBeCloseTo(0, 5);
    });
  });

  describe('l2NormalizeCopy', () => {
    it('should return normalized copy without modifying original', () => {
      const original = new Float32Array([3, 4]);
      const normalized = l2NormalizeCopy(original);

      // Original unchanged
      expect(original[0]).toBe(3);
      expect(original[1]).toBe(4);

      // Copy is normalized
      const norm = Math.sqrt(normalized[0] * normalized[0] + normalized[1] * normalized[1]);
      expect(norm).toBeCloseTo(1, 5);
    });

    it('should handle Array input', () => {
      const original = [3, 4];
      const normalized = l2NormalizeCopy(original);

      expect(normalized).toBeInstanceOf(Float32Array);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
    });

    it('should return null for null input', () => {
      expect(l2NormalizeCopy(null)).toBeNull();
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = new Float32Array([0.6, 0.8]);
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = new Float32Array([1, 0]);
      const vec2 = new Float32Array([0, 1]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const vec1 = new Float32Array([1, 0]);
      const vec2 = new Float32Array([-1, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
    });

    it('should handle normalized vectors correctly', () => {
      // 45 degrees apart
      const vec1 = new Float32Array([1, 0]);
      const vec2 = new Float32Array([Math.SQRT1_2, Math.SQRT1_2]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(Math.SQRT1_2, 5);
    });

    it('should return 0 for null inputs', () => {
      expect(cosineSimilarity(null, new Float32Array([1, 0]))).toBe(0);
      expect(cosineSimilarity(new Float32Array([1, 0]), null)).toBe(0);
    });

    it('should return 0 for mismatched lengths', () => {
      const vec1 = new Float32Array([1, 0]);
      const vec2 = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });
  });
});
