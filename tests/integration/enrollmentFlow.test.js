/**
 * Integration tests for enrollment flow
 *
 * These tests verify that enrolled speakers are correctly propagated
 * through the system during live recording.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpeakerClusterer } from '../../src/core/embedding/speakerClusterer.js';
import { TranscriptMerger } from '../../src/core/transcription/transcriptMerger.js';

// Helper to create a normalized embedding
function createEmbedding(seed, dim = 512) {
  const embedding = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    embedding[i] = Math.sin(seed * (i + 1)) + Math.cos(seed * i * 0.5);
  }
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

// Helper to create similar embedding
function createSimilarEmbedding(base, noiseLevel = 0.05) {
  const embedding = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    embedding[i] = base[i] + (Math.random() - 0.5) * noiseLevel;
  }
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

describe('Enrollment Flow Integration', () => {
  describe('Channel Merger Enrollment Propagation', () => {
    /**
     * This test replicates the bug where channel mergers were created
     * without enrolled speakers, causing live recording to not recognize
     * enrolled speakers.
     *
     * The bug was: channelMergers.get(channelId) would create a NEW
     * TranscriptMerger with an empty SpeakerClusterer, losing enrollments.
     */
    it('should propagate enrolled speakers to channel mergers', () => {
      // Setup: Main merger with enrolled speaker (simulates loadSavedEnrollments)
      const mainMerger = new TranscriptMerger({ numSpeakers: 2 });
      const jakeEmbedding = createEmbedding(42);

      mainMerger.speakerClusterer.importEnrolledSpeakers([
        { id: '1', name: 'Jake', centroid: Array.from(jakeEmbedding), colorIndex: 0 },
      ]);

      expect(mainMerger.speakerClusterer.getEnrolledCount()).toBe(1);

      // Simulate what App.handleTranscriptionResult does for channel mergers
      const channelMergers = new Map();

      // This is the FIXED pattern - export from main, import to channel merger
      function getOrCreateChannelMerger(channelId) {
        let merger = channelMergers.get(channelId);
        if (!merger) {
          merger = new TranscriptMerger({ numSpeakers: 2 });

          // THE FIX: Import enrolled speakers from main clusterer
          const enrolledSpeakers = mainMerger.speakerClusterer.exportEnrolledSpeakers();
          if (enrolledSpeakers.length > 0) {
            merger.speakerClusterer.importEnrolledSpeakers(enrolledSpeakers);
          }

          channelMergers.set(channelId, merger);
        }
        return merger;
      }

      // Get channel merger (simulates first audio chunk arriving)
      const channelMerger = getOrCreateChannelMerger(0);

      // Verify enrolled speaker was propagated
      expect(channelMerger.speakerClusterer.getEnrolledCount()).toBe(1);

      // Verify it can match Jake's voice
      const jakeSpeaking = createSimilarEmbedding(jakeEmbedding, 0.05);
      const result = channelMerger.speakerClusterer.assignSpeaker(jakeSpeaking, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.isEnrolled).toBe(true);
      expect(channelMerger.speakerClusterer.getSpeakerLabel(result.speakerId)).toBe('Jake');
    });

    it('should fail to match enrolled speaker WITHOUT propagation (demonstrates the bug)', () => {
      // Setup: Main merger with enrolled speaker
      const mainMerger = new TranscriptMerger({ numSpeakers: 2 });
      const jakeEmbedding = createEmbedding(42);

      mainMerger.speakerClusterer.importEnrolledSpeakers([
        { id: '1', name: 'Jake', centroid: Array.from(jakeEmbedding), colorIndex: 0 },
      ]);

      // THE BUG: Create channel merger WITHOUT importing enrolled speakers
      const channelMerger = new TranscriptMerger({ numSpeakers: 2 });
      // No import! This is what the bug was.

      // Verify NO enrolled speaker in channel merger
      expect(channelMerger.speakerClusterer.getEnrolledCount()).toBe(0);

      // When Jake speaks, it creates "Speaker 1" instead of matching "Jake"
      const jakeSpeaking = createSimilarEmbedding(jakeEmbedding, 0.05);
      const result = channelMerger.speakerClusterer.assignSpeaker(jakeSpeaking, true);

      expect(result.speakerId).toBe(0);
      expect(result.debug.isEnrolled).toBe(false); // NOT enrolled!
      expect(result.debug.reason).toBe('new_speaker'); // Creates new speaker
      expect(channelMerger.speakerClusterer.getSpeakerLabel(result.speakerId)).toBe('Speaker 1'); // NOT "Jake"
    });
  });

  describe('TranscriptMerger Reset with Enrollments', () => {
    it('should preserve enrolled speakers on reset(true)', () => {
      const merger = new TranscriptMerger({ numSpeakers: 2 });

      // Import enrollment
      merger.speakerClusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);

      // Add some discovered speakers via assignment
      merger.speakerClusterer.assignSpeaker(createEmbedding(100));

      expect(merger.speakerClusterer.speakers.length).toBe(2);
      expect(merger.speakerClusterer.getEnrolledCount()).toBe(1);

      // Reset (default preserves enrolled)
      merger.reset();

      expect(merger.speakerClusterer.speakers.length).toBe(1);
      expect(merger.speakerClusterer.getEnrolledCount()).toBe(1);
      expect(merger.speakerClusterer.speakers[0].name).toBe('Alice');
    });

    it('should clear enrolled speakers on reset(false)', () => {
      const merger = new TranscriptMerger({ numSpeakers: 2 });

      merger.speakerClusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(createEmbedding(1)), colorIndex: 0 },
      ]);

      merger.reset(false);

      expect(merger.speakerClusterer.speakers.length).toBe(0);
      expect(merger.speakerClusterer.getEnrolledCount()).toBe(0);
    });
  });

  describe('End-to-end enrollment matching', () => {
    it('should attribute phrases to enrolled speaker', () => {
      const merger = new TranscriptMerger({ numSpeakers: 2 });
      const aliceEmbedding = createEmbedding(1);

      // Enroll Alice
      merger.speakerClusterer.importEnrolledSpeakers([
        { id: '1', name: 'Alice', centroid: Array.from(aliceEmbedding), colorIndex: 0 },
      ]);

      // Simulate phrase with Alice's voice
      const phrases = [{
        text: 'Hello world',
        words: [{ text: 'Hello' }, { text: 'world' }],
        start: 0,
        end: 1.5,
        embedding: createSimilarEmbedding(aliceEmbedding, 0.05),
      }];

      // Process phrases through merger's clusterer
      const processed = merger.speakerClusterer.processPhrases(phrases);

      expect(processed[0].clusteredSpeakerId).toBe(0);
      expect(processed[0].clusteringDebug.isEnrolled).toBe(true);
    });
  });
});
