/**
 * Speaker Clusterer
 * Uses speaker embeddings to cluster and identify unique speakers across audio chunks
 */

export class SpeakerClusterer {
  constructor(numSpeakers = 2) {
    this.numSpeakers = numSpeakers;
    // Each speaker has { centroid: Float32Array, count: number }
    this.speakers = [];
    // Similarity threshold for matching (cosine similarity)
    this.similarityThreshold = 0.7;
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   * @param {Float32Array|Array} a - First embedding
   * @param {Float32Array|Array} b - Second embedding
   * @returns {number} Similarity score between -1 and 1
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  /**
   * Find the best matching speaker for an embedding
   * @param {Float32Array|Array} embedding - The speaker embedding
   * @returns {{ speakerId: number, similarity: number } | null}
   */
  findBestMatch(embedding) {
    if (!embedding || this.speakers.length === 0) return null;

    let bestSpeaker = -1;
    let bestSimilarity = -1;

    for (let i = 0; i < this.speakers.length; i++) {
      const similarity = this.cosineSimilarity(embedding, this.speakers[i].centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestSpeaker = i;
      }
    }

    return { speakerId: bestSpeaker, similarity: bestSimilarity };
  }

  /**
   * Update speaker centroid with a new embedding (running average)
   * @param {number} speakerId - The speaker ID
   * @param {Float32Array|Array} embedding - New embedding to incorporate
   */
  updateCentroid(speakerId, embedding) {
    if (!embedding || speakerId < 0 || speakerId >= this.speakers.length) return;

    const speaker = this.speakers[speakerId];
    const count = speaker.count;
    const centroid = speaker.centroid;

    // Running average: new_centroid = (old_centroid * count + new_embedding) / (count + 1)
    for (let i = 0; i < centroid.length; i++) {
      centroid[i] = (centroid[i] * count + embedding[i]) / (count + 1);
    }
    speaker.count++;
  }

  /**
   * Assign a speaker ID to a segment based on its embedding
   * Uses online clustering: matches to existing speaker or creates new one
   * @param {Float32Array|Array} embedding - The speaker embedding
   * @returns {number} Assigned speaker ID
   */
  assignSpeaker(embedding) {
    if (!embedding) {
      // No embedding - assign to speaker 0 by default
      return 0;
    }

    // If no speakers yet, create the first one
    if (this.speakers.length === 0) {
      this.speakers.push({
        centroid: new Float32Array(embedding),
        count: 1,
      });
      return 0;
    }

    // Find best matching speaker
    const match = this.findBestMatch(embedding);

    // If similarity is above threshold, assign to that speaker
    if (match.similarity >= this.similarityThreshold) {
      this.updateCentroid(match.speakerId, embedding);
      return match.speakerId;
    }

    // If we haven't reached numSpeakers yet, create a new speaker
    if (this.speakers.length < this.numSpeakers) {
      const newId = this.speakers.length;
      this.speakers.push({
        centroid: new Float32Array(embedding),
        count: 1,
      });
      return newId;
    }

    // We've reached max speakers - assign to closest one even if below threshold
    this.updateCentroid(match.speakerId, embedding);
    return match.speakerId;
  }

  /**
   * Process segments and assign consistent speaker IDs
   * @param {Array} segments - Segments with embeddings from diarization
   * @returns {Array} Segments with assigned speaker IDs
   */
  processSegments(segments) {
    return segments.map((segment) => {
      const speakerId = this.assignSpeaker(segment.embedding);
      return {
        ...segment,
        clusteredSpeakerId: speakerId,
      };
    });
  }

  /**
   * Set the expected number of speakers
   * @param {number} n - Number of speakers
   */
  setNumSpeakers(n) {
    this.numSpeakers = Math.max(1, Math.min(n, 10));
  }

  /**
   * Get the current number of detected speakers
   * @returns {number}
   */
  getDetectedSpeakerCount() {
    return this.speakers.length;
  }

  /**
   * Reset the clusterer for a new recording session
   * @param {boolean} preserveEnrolled - If true, keeps all enrolled speakers
   */
  reset(preserveEnrolled = false) {
    if (preserveEnrolled) {
      // Keep only enrolled speakers
      this.speakers = this.speakers.filter((s) => s.enrolled);
    } else {
      this.speakers = [];
    }
  }

  /**
   * Get human-readable speaker label
   * Uses custom name if speaker was enrolled with one
   * @param {number} speakerId
   * @returns {string}
   */
  getSpeakerLabel(speakerId) {
    const speaker = this.speakers[speakerId];
    if (speaker?.name) {
      return speaker.name;
    }
    return `Speaker ${speakerId + 1}`;
  }

  /**
   * Pre-enroll a speaker with a known embedding
   * Enrolled speakers are added at the beginning and take priority in matching
   * @param {string} name - Custom name for the speaker
   * @param {Float32Array|Array} embedding - The speaker's voice embedding
   * @param {string} enrollmentId - Unique ID for this enrollment
   * @param {number} colorIndex - Color index for UI display
   */
  enrollSpeaker(name, embedding, enrollmentId = null, colorIndex = 0) {
    // Add enrolled speaker at the end of enrolled speakers (before discovered ones)
    const enrolledCount = this.getEnrolledCount();
    const newSpeaker = {
      centroid: new Float32Array(embedding),
      count: 1,
      name: name,
      enrolled: true,
      enrollmentId: enrollmentId || Date.now().toString(),
      colorIndex: colorIndex,
    };

    // Insert at the position after other enrolled speakers
    this.speakers.splice(enrolledCount, 0, newSpeaker);
  }

  /**
   * Check if we have any enrolled speakers
   * @returns {boolean}
   */
  hasEnrolledSpeaker() {
    return this.speakers.some((s) => s.enrolled);
  }

  /**
   * Get count of enrolled speakers
   * @returns {number}
   */
  getEnrolledCount() {
    return this.speakers.filter((s) => s.enrolled).length;
  }

  /**
   * Import all enrolled speakers from saved data
   * @param {Array} enrollments - Array of {id, name, centroid, colorIndex}
   */
  importEnrolledSpeakers(enrollments) {
    if (!enrollments || !Array.isArray(enrollments)) return;

    // Clear existing enrolled speakers
    this.speakers = this.speakers.filter((s) => !s.enrolled);

    // Add all enrollments at the beginning
    for (let i = enrollments.length - 1; i >= 0; i--) {
      const e = enrollments[i];
      if (!e.centroid) continue;

      this.speakers.unshift({
        centroid: new Float32Array(e.centroid),
        count: 1,
        name: e.name,
        enrolled: true,
        enrollmentId: e.id,
        colorIndex: e.colorIndex ?? i,
      });
    }
  }

  /**
   * Export all enrolled speakers for localStorage persistence
   * @returns {Array} Array of serializable enrollment data
   */
  exportEnrolledSpeakers() {
    return this.speakers
      .filter((s) => s.enrolled)
      .map((s) => ({
        id: s.enrollmentId,
        name: s.name,
        centroid: Array.from(s.centroid),
        colorIndex: s.colorIndex,
      }));
  }

  /**
   * Remove a specific enrolled speaker by enrollment ID
   * @param {string} enrollmentId - ID of enrollment to remove
   */
  removeEnrolledSpeaker(enrollmentId) {
    this.speakers = this.speakers.filter(
      (s) => !s.enrolled || s.enrollmentId !== enrollmentId
    );
  }

  /**
   * Clear all enrollments (keeps discovered speakers)
   */
  clearAllEnrollments() {
    this.speakers = this.speakers.filter((s) => !s.enrolled);
  }

  /**
   * Get all speakers (enrolled + discovered) for visualization
   * @returns {Array} Array of {id, name, centroid, enrolled, colorIndex}
   */
  getAllSpeakersForVisualization() {
    return this.speakers.map((s, i) => ({
      id: s.enrollmentId || `discovered-${i}`,
      name: s.name || `Speaker ${i + 1}`,
      centroid: s.centroid,
      enrolled: !!s.enrolled,
      colorIndex: s.colorIndex ?? i,
    }));
  }

  // Legacy methods for backward compatibility
  exportEnrolledSpeaker() {
    const enrolled = this.speakers.find((s) => s.enrolled);
    if (!enrolled) return null;
    return {
      name: enrolled.name,
      centroid: Array.from(enrolled.centroid),
    };
  }

  importEnrolledSpeaker(data) {
    if (!data || !data.centroid) return;
    this.importEnrolledSpeakers([{
      id: Date.now().toString(),
      name: data.name,
      centroid: data.centroid,
      colorIndex: 0,
    }]);
  }

  clearEnrollment() {
    this.clearAllEnrollments();
  }
}
