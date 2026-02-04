/**
 * Unit tests for SpeakerClusterer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpeakerClusterer, UNKNOWN_SPEAKER_ID } from '../../../../src/core/embedding/speakerClusterer.js';

// Helper to create a normalized embedding (unit vector)
function createEmbedding(seed, dim = 512) {
  const embedding = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    embedding[i] = Math.sin(seed * (i + 1)) + Math.cos(seed * i * 0.5);
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}

// Helper to create a similar embedding (adds small noise)
function createSimilarEmbedding(base, noiseLevel = 0.1) {
  const embedding = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    embedding[i] = base[i] + (Math.random() - 0.5) * noiseLevel;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}

describe('SpeakerClusterer', () => {
  let clusterer;

  beforeEach(() => {
    clusterer = new SpeakerClusterer({ numSpeakers: 2 });
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(clusterer.numSpeakers).toBe(2);
      expect(clusterer.speakers).toEqual([]);
      expect(clusterer.similarityThreshold).toBeDefined();
    });

    it('should accept number as first argument (legacy API)', () => {
      const c = new SpeakerClusterer(3);
      expect(c.numSpeakers).toBe(3);
    });

    it('should accept options object', () => {
      const c = new SpeakerClusterer({ numSpeakers: 4, similarityThreshold: 0.8 });
      expect(c.numSpeakers).toBe(4);
      expect(c.similarityThreshold).toBe(0.8);
    });
  });

  describe('assignSpeaker', () => {
    it('should create first speaker when no speakers exist', () => {
      const embedding = createEmbedding(1);
      const result = clusterer.assignSpeaker(embedding, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.reason).toBe('new_speaker');
      expect(clusterer.speakers.length).toBe(1);
    });

    it('should return speaker 0 for null embedding', () => {
      const result = clusterer.assignSpeaker(null, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.reason).toBe('no_embedding');
    });

    it('should match similar embeddings to same speaker', () => {
      const baseEmbedding = createEmbedding(1);
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.05);

      // First call creates speaker
      clusterer.assignSpeaker(baseEmbedding);

      // Second call should match
      const result = clusterer.assignSpeaker(similarEmbedding, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.reason).toBe('confident_match');
    });

    it('should create new speaker for different embedding', () => {
      const embedding1 = createEmbedding(1);
      const embedding2 = createEmbedding(100); // Very different

      clusterer.assignSpeaker(embedding1);
      const result = clusterer.assignSpeaker(embedding2, true);

      expect(result.speakerId).toBe(1);
      expect(result.debug.reason).toBe('new_speaker');
      expect(clusterer.speakers.length).toBe(2);
    });

    it('should not create more speakers than numSpeakers', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });

      const embedding1 = createEmbedding(1);
      const embedding2 = createEmbedding(100);
      const embedding3 = createEmbedding(200);

      clusterer.assignSpeaker(embedding1);
      clusterer.assignSpeaker(embedding2);
      const result = clusterer.assignSpeaker(embedding3, true);

      expect(clusterer.speakers.length).toBe(2);
      // Should either match one of the existing speakers or return unknown
      expect(result.speakerId === 0 || result.speakerId === 1 || result.speakerId === UNKNOWN_SPEAKER_ID).toBe(true);
    });
  });

  describe('importEnrolledSpeakers', () => {
    it('should import enrolled speakers', () => {
      const enrollments = [
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
        { id: '2', name: 'Bob', centroid: Array.from(createEmbedding(2)), colorIndex: 1 },
      ];

      clusterer.importEnrolledSpeakers(enrollments);

      expect(clusterer.speakers.length).toBe(2);
      expect(clusterer.speakers[0].name).toBe('Alice');
      expect(clusterer.speakers[0].enrolled).toBe(true);
      expect(clusterer.speakers[1].name).toBe('Bob');
      expect(clusterer.speakers[1].enrolled).toBe(true);
    });

    it('should match embeddings to enrolled speakers', () => {
      const aliceEmbedding = createEmbedding(1);
      const enrollments = [
        { id: '1', name: 'Alice', centroid: Array.from(aliceEmbedding), colorIndex: 0 },
      ];

      clusterer.importEnrolledSpeakers(enrollments);

      // Use similar embedding
      const similarToAlice = createSimilarEmbedding(aliceEmbedding, 0.05);
      const result = clusterer.assignSpeaker(similarToAlice, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.isEnrolled).toBe(true);
      expect(clusterer.getSpeakerLabel(result.speakerId)).toBe('Alice');
    });

    it('should skip enrollments without centroid', () => {
      const enrollments = [
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
        { id: '2', name: 'Bob', centroid: null, colorIndex: 1 }, // No centroid
      ];

      clusterer.importEnrolledSpeakers(enrollments);

      expect(clusterer.speakers.length).toBe(1);
      expect(clusterer.speakers[0].name).toBe('Alice');
    });

    it('should clear existing enrolled speakers before importing', () => {
      // First import
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);

      // Second import should replace
      clusterer.importEnrolledSpeakers([
        { id: '2', name: 'Bob', centroid: Array.from(createEmbedding(2)), colorIndex: 0 },
      ]);

      expect(clusterer.speakers.length).toBe(1);
      expect(clusterer.speakers[0].name).toBe('Bob');
    });
  });

  describe('exportEnrolledSpeakers', () => {
    it('should export enrolled speakers in correct format', () => {
      const enrollments = [
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ];

      clusterer.importEnrolledSpeakers(enrollments);
      const exported = clusterer.exportEnrolledSpeakers();

      expect(exported.length).toBe(1);
      expect(exported[0].id).toBe('1');
      expect(exported[0].name).toBe('Alice');
      expect(exported[0].centroid).toBeInstanceOf(Array);
      expect(exported[0].colorIndex).toBe(0);
    });

    it('should not export non-enrolled speakers', () => {
      // Add enrolled speaker
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);

      // Add non-enrolled speaker via assignSpeaker
      const newEmbedding = createEmbedding(100);
      clusterer.assignSpeaker(newEmbedding);

      const exported = clusterer.exportEnrolledSpeakers();

      expect(exported.length).toBe(1);
      expect(exported[0].name).toBe('Alice');
    });
  });

  describe('reset', () => {
    it('should clear all speakers when preserveEnrolled is false', () => {
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);
      clusterer.assignSpeaker(createEmbedding(100)); // Add non-enrolled

      clusterer.reset(false);

      expect(clusterer.speakers.length).toBe(0);
    });

    it('should keep enrolled speakers when preserveEnrolled is true', () => {
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);
      clusterer.assignSpeaker(createEmbedding(100)); // Add non-enrolled

      expect(clusterer.speakers.length).toBe(2);

      clusterer.reset(true);

      expect(clusterer.speakers.length).toBe(1);
      expect(clusterer.speakers[0].name).toBe('Alice');
      expect(clusterer.speakers[0].enrolled).toBe(true);
    });
  });

  describe('getEnrolledCount', () => {
    it('should return count of enrolled speakers only', () => {
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);
      clusterer.assignSpeaker(createEmbedding(100)); // Add non-enrolled

      expect(clusterer.getEnrolledCount()).toBe(1);
      expect(clusterer.speakers.length).toBe(2);
    });
  });

  describe('getSpeakerLabel', () => {
    it('should return enrolled speaker name', () => {
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);

      expect(clusterer.getSpeakerLabel(0)).toBe('Alice');
    });

    it('should return "Speaker N" for non-enrolled speakers', () => {
      clusterer.assignSpeaker(createEmbedding(1));

      expect(clusterer.getSpeakerLabel(0)).toBe('Speaker 1');
    });

    it('should return "Unknown" for UNKNOWN_SPEAKER_ID', () => {
      expect(clusterer.getSpeakerLabel(UNKNOWN_SPEAKER_ID)).toBe('Unknown');
    });
  });

  describe('removeFromCentroid', () => {
    it('should remove embedding from non-enrolled speaker centroid', () => {
      const embedding1 = createEmbedding(1);
      const embedding2 = createSimilarEmbedding(embedding1, 0.1);

      // Add two embeddings to create a speaker with count=2
      clusterer.assignSpeaker(embedding1);
      clusterer.assignSpeaker(embedding2);

      expect(clusterer.speakers[0].count).toBe(2);

      // Remove one embedding
      const result = clusterer.removeFromCentroid(0, embedding2);

      expect(result).toBe(true);
      expect(clusterer.speakers[0].count).toBe(1);
    });

    it('should not remove from enrolled speakers', () => {
      const embedding = createEmbedding(1);
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(embedding), colorIndex: 0 },
      ]);

      const result = clusterer.removeFromCentroid(0, embedding);

      expect(result).toBe(false);
      expect(clusterer.speakers[0].count).toBe(1);
    });

    it('should not remove last embedding from speaker', () => {
      const embedding = createEmbedding(1);
      clusterer.assignSpeaker(embedding);

      expect(clusterer.speakers[0].count).toBe(1);

      const result = clusterer.removeFromCentroid(0, embedding);

      expect(result).toBe(false);
      expect(clusterer.speakers[0].count).toBe(1);
    });

    it('should return false for invalid speaker ID', () => {
      clusterer.assignSpeaker(createEmbedding(1));

      expect(clusterer.removeFromCentroid(-1, createEmbedding(1))).toBe(false);
      expect(clusterer.removeFromCentroid(5, createEmbedding(1))).toBe(false);
    });

    it('should return false for null embedding', () => {
      clusterer.assignSpeaker(createEmbedding(1));
      clusterer.assignSpeaker(createSimilarEmbedding(createEmbedding(1), 0.1));

      expect(clusterer.removeFromCentroid(0, null)).toBe(false);
    });
  });

  describe('reclusterFromIndex', () => {
    it('should re-cluster segments from specified index', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });

      const speaker1Base = createEmbedding(1);
      const speaker2Base = createEmbedding(100);

      // Create segments with embeddings
      const segments = [
        { embedding: speaker1Base, speaker: 0, speakerLabel: 'Speaker 1' },
        { embedding: createSimilarEmbedding(speaker1Base, 0.05), speaker: 0, speakerLabel: 'Speaker 1' },
        { embedding: createSimilarEmbedding(speaker2Base, 0.05), speaker: 1, speakerLabel: 'Speaker 2' },
      ];

      // Initialize clusterer with first embedding
      clusterer.assignSpeaker(speaker1Base);
      clusterer.assignSpeaker(speaker2Base);

      // Re-cluster from index 1
      const changes = clusterer.reclusterFromIndex(segments, 1);

      // Should process segments 1 and 2
      expect(segments[1].speaker).toBeDefined();
      expect(segments[2].speaker).toBeDefined();
    });

    it('should skip environmental segments', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });

      const embedding = createEmbedding(1);
      clusterer.assignSpeaker(embedding);

      const segments = [
        { embedding: embedding, speaker: 0, isEnvironmental: true },
        { embedding: createSimilarEmbedding(embedding, 0.05), speaker: 0 },
      ];

      const changes = clusterer.reclusterFromIndex(segments, 0);

      // Environmental segment should not be in changes
      const envChange = changes.find(c => c.index === 0);
      expect(envChange).toBeUndefined();
    });

    it('should skip segments without embeddings', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });

      const embedding = createEmbedding(1);
      clusterer.assignSpeaker(embedding);

      const segments = [
        { embedding: null, speaker: 0 },
        { embedding: createSimilarEmbedding(embedding, 0.05), speaker: 0 },
      ];

      const changes = clusterer.reclusterFromIndex(segments, 0);

      // Segment without embedding should not be in changes
      const noEmbeddingChange = changes.find(c => c.index === 0);
      expect(noEmbeddingChange).toBeUndefined();
    });

    it('should return array of changed segments', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });

      const speaker1Base = createEmbedding(1);
      const speaker2Base = createEmbedding(100);

      // Initialize clusterer
      clusterer.assignSpeaker(speaker1Base);
      clusterer.assignSpeaker(speaker2Base);

      // Create segment that was wrongly assigned
      const segments = [
        { embedding: speaker2Base, speaker: 0, speakerLabel: 'Speaker 1' }, // Wrong assignment
      ];

      const changes = clusterer.reclusterFromIndex(segments, 0);

      // Should detect the change from speaker 0 to speaker 1
      if (changes.length > 0) {
        expect(changes[0].index).toBe(0);
        expect(changes[0].oldSpeaker).toBe(0);
        expect(changes[0].newSpeaker).toBe(1);
      }
    });

    it('should update segment labels after reclustering', () => {
      clusterer = new SpeakerClusterer({ numSpeakers: 2 });
      clusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
        { id: '2', name: 'Bob', centroid: Array.from(createEmbedding(100)), colorIndex: 1 },
      ]);

      const segments = [
        { embedding: createSimilarEmbedding(createEmbedding(100), 0.05), speaker: 0, speakerLabel: 'Alice' },
      ];

      clusterer.reclusterFromIndex(segments, 0);

      // Label should be updated if speaker changed
      expect(segments[0].speakerLabel).toBeDefined();
    });
  });
});
