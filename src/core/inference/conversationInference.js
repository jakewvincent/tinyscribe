/**
 * Conversation-Level Speaker Inference
 *
 * Builds hypotheses about which enrolled speakers are participating in the conversation,
 * applies boosting to competitive matches, and handles retroactive re-attribution.
 */

import { CONVERSATION_INFERENCE_DEFAULTS, CLUSTERING_DEFAULTS, ATTRIBUTION_UI_DEFAULTS } from '../../config/defaults.js';

/**
 * @typedef {Object} ParticipantHypothesis
 * @property {string} speakerName - Name of the hypothesized participant
 * @property {number} confidence - Confidence score (0-1)
 * @property {number} segmentCount - Number of segments where this speaker was competitive
 * @property {number} avgSimilarity - Average similarity when competitive
 */

/**
 * @typedef {Object} Hypothesis
 * @property {ParticipantHypothesis[]} participants - List of hypothesized participants
 * @property {number} version - Increments when hypothesis changes
 * @property {number} totalSegments - Total segments processed
 */

/**
 * @typedef {Object} DisplayInfo
 * @property {string} label - Primary display label
 * @property {string|null} alternateLabel - Secondary label for ambiguous cases
 * @property {boolean} showAlternate - Whether to show alternate label
 * @property {boolean} isUnexpected - Whether this is an unexpected speaker
 */

/**
 * @typedef {Object} SegmentAttribution
 * @property {number} segmentIndex - Index of the segment
 * @property {Object} originalAttribution - Original clustering result (preserved)
 * @property {Object} boostedAttribution - Attribution after boosting applied
 * @property {DisplayInfo} displayInfo - How to display this attribution
 * @property {number} hypothesisVersion - Version of hypothesis used
 * @property {boolean} wasInfluenced - Whether boosting changed the outcome
 */

export class ConversationInference {
  constructor(config = {}) {
    this.config = { ...CONVERSATION_INFERENCE_DEFAULTS, ...config };

    // Current hypothesis about who's in the conversation
    this.hypothesis = {
      participants: [],
      version: 0,
      totalSegments: 0,
    };

    // Track all segment attributions
    this.segmentAttributions = [];

    // Per-speaker statistics for hypothesis building
    // speakerName -> { name, competitiveCount, similarities[], bestMatchCount, timeSeries[] }
    this.speakerStats = new Map();

    // Hypothesis change history for Feature 9
    this.hypothesisHistory = [];

    // Expected number of speakers (from UI dropdown)
    this.expectedSpeakers = 2;

    // Enrolled speaker info (set by app.js)
    this.enrolledSpeakers = [];

    // Callback for when segments need re-rendering
    this.onAttributionChange = null;
  }

  /**
   * Set the expected number of speakers from UI
   */
  setExpectedSpeakers(count) {
    const oldCount = this.expectedSpeakers;
    this.expectedSpeakers = count;

    // If we have segments and count changed, recalculate
    if (this.segmentAttributions.length > 0 && oldCount !== count) {
      return this.recalculateAllAttributions();
    }
    return [];
  }

  /**
   * Update enrolled speakers list
   */
  setEnrolledSpeakers(speakers) {
    this.enrolledSpeakers = speakers || [];
  }

  /**
   * Process a new segment and return its attribution
   * @param {Object} segment - Segment with clustering results
   * @param {number} index - Segment index
   * @returns {SegmentAttribution} Attribution for this segment
   */
  processNewSegment(segment, index) {
    // Build original attribution from segment's clustering data
    // Segment structure: { speaker, speakerLabel, debug: { clustering: { allSimilarities, ... } } }
    const clustering = segment.debug?.clustering;

    // Map and SORT allSimilarities by similarity (descending)
    // Note: allSimilarities from clusterer is NOT sorted - it's in enrollment order
    const allMatches = clustering?.allSimilarities
      ?.map(s => ({
        speakerName: s.speaker,
        similarity: s.similarity,
        enrolled: s.enrolled,
      }))
      .sort((a, b) => b.similarity - a.similarity) || [];

    const originalAttribution = clustering ? {
      speakerId: segment.speaker,
      speakerName: segment.speakerLabel || 'Unknown',
      debug: {
        allMatches,
        similarity: clustering.similarity,
        margin: clustering.margin,
        reason: clustering.reason,
      },
    } : null;

    if (!originalAttribution || !originalAttribution.debug?.allMatches?.length) {
      // No clustering data, return minimal attribution
      const attribution = {
        segmentIndex: index,
        originalAttribution,
        boostedAttribution: originalAttribution,
        displayInfo: this.buildDisplayInfo(null, null, 0),
        hypothesisVersion: this.hypothesis.version,
        wasInfluenced: false,
      };
      this.segmentAttributions[index] = attribution;
      return attribution;
    }

    // Update speaker statistics
    this.updateSpeakerStats(originalAttribution);
    this.hypothesis.totalSegments++;

    // Apply boosting with current hypothesis
    const boostedAttribution = this.applyBoosting(originalAttribution);

    // Build display info
    const displayInfo = this.buildDisplayInfoFromAttribution(boostedAttribution, originalAttribution);

    const attribution = {
      segmentIndex: index,
      originalAttribution,
      boostedAttribution,
      displayInfo,
      hypothesisVersion: this.hypothesis.version,
      wasInfluenced: boostedAttribution.wasInfluenced || false,
    };

    this.segmentAttributions[index] = attribution;

    // Check if hypothesis should update
    const shouldUpdate = this.shouldUpdateHypothesis();
    if (shouldUpdate) {
      return { attribution, changedSegments: this.recalculateAllAttributions() };
    }

    return { attribution, changedSegments: [] };
  }

  /**
   * Update statistics for hypothesis building
   */
  updateSpeakerStats(attribution) {
    const debug = attribution.debug;
    if (!debug || !debug.allMatches) return;

    // Track top 2 speakers as "competitive"
    // Note: allMatches is already sorted by similarity (descending)
    const topMatches = debug.allMatches.slice(0, this.config.boostEligibilityRank);

    for (const match of topMatches) {
      // Use speakerName as the unique key (speakerId not available in allSimilarities)
      if (!this.speakerStats.has(match.speakerName)) {
        this.speakerStats.set(match.speakerName, {
          name: match.speakerName,
          competitiveCount: 0,
          similarities: [],
          bestMatchCount: 0,
          timeSeries: [], // Feature 8: Time series for trend tracking
        });
      }

      const stats = this.speakerStats.get(match.speakerName);
      stats.competitiveCount++;
      stats.similarities.push(match.similarity);

      // Feature 8: Track time series data
      stats.timeSeries.push({
        segmentIndex: this.hypothesis.totalSegments,
        similarity: match.similarity,
        timestamp: Date.now(),
        rank: match === topMatches[0] ? 1 : 2,
      });

      if (match === topMatches[0]) {
        stats.bestMatchCount++;
      }
    }
  }

  /**
   * Determine if hypothesis should be rebuilt
   */
  shouldUpdateHypothesis() {
    const { minSegmentsForHypothesis } = this.config;

    // Need minimum segments before forming hypothesis
    if (this.hypothesis.totalSegments < minSegmentsForHypothesis) {
      return false;
    }

    // Update every few segments after initial hypothesis
    const updateInterval = Math.max(2, Math.floor(minSegmentsForHypothesis / 2));
    return this.hypothesis.totalSegments % updateInterval === 0;
  }

  /**
   * Build or rebuild the hypothesis about who's in the conversation
   */
  buildHypothesis() {
    const {
      participantConfidenceThreshold,
      participantMinOccurrences,
    } = this.config;

    const candidates = [];

    // speakerStats is keyed by speakerName
    for (const [speakerName, stats] of this.speakerStats) {
      // Include all speakers who meet the quality thresholds
      // No filtering by enrollment status - all speakers treated equally

      // Calculate average similarity when competitive
      const avgSimilarity = stats.similarities.length > 0
        ? stats.similarities.reduce((a, b) => a + b, 0) / stats.similarities.length
        : 0;

      // Must meet minimum criteria
      if (stats.competitiveCount < participantMinOccurrences) continue;
      if (avgSimilarity < participantConfidenceThreshold) continue;

      // Score = occurrences * average similarity (rewards both consistency and quality)
      const score = stats.competitiveCount * avgSimilarity;

      candidates.push({
        speakerName,
        confidence: avgSimilarity,
        segmentCount: stats.competitiveCount,
        avgSimilarity,
        score,
      });
    }

    // Sort by score and take top N
    candidates.sort((a, b) => b.score - a.score);
    const participants = candidates.slice(0, this.expectedSpeakers);

    // Check if hypothesis actually changed (compare by speakerName)
    const oldParticipants = new Set(this.hypothesis.participants.map(p => p.speakerName));
    const newParticipants = new Set(participants.map(p => p.speakerName));

    const changed = oldParticipants.size !== newParticipants.size ||
      [...oldParticipants].some(name => !newParticipants.has(name));

    if (changed) {
      // Feature 9: Track hypothesis change history
      const added = [...newParticipants].filter(name => !oldParticipants.has(name));
      const removed = [...oldParticipants].filter(name => !newParticipants.has(name));

      this.hypothesisHistory.push({
        version: this.hypothesis.version + 1,
        timestamp: Date.now(),
        totalSegments: this.hypothesis.totalSegments,
        changes: { added, removed },
        participantsBefore: [...oldParticipants],
        participantsAfter: [...newParticipants],
      });

      this.hypothesis.version++;
    }

    this.hypothesis.participants = participants;

    return changed;
  }

  /**
   * Apply boosting to an attribution based on current hypothesis
   *
   * Boosting is now gated and selective:
   * 1. Ambiguity gating: Only boost when the decision is genuinely uncertain
   * 2. Contender-only: Only boost speakers who could benefit from the boost
   */
  applyBoosting(originalAttribution) {
    const debug = originalAttribution.debug;
    if (!debug || !debug.allMatches || debug.allMatches.length === 0) {
      return { ...originalAttribution, wasInfluenced: false, boostSkipped: true, skipReason: 'no_matches' };
    }

    const {
      boostFactor,
      boostEligibilityRank,
      minSimilarityAfterBoost,
      ambiguityMarginThreshold,
      skipBoostIfConfident,
      minSimilarityForBoosting,
    } = this.config;

    // Get participant names for quick lookup
    const participantNames = new Set(this.hypothesis.participants.map(p => p.speakerName));

    // Calculate original margin and best similarity for gating decision
    const originalBest = debug.allMatches[0];
    const originalSecond = debug.allMatches[1];
    const originalMargin = originalSecond
      ? originalBest.similarity - originalSecond.similarity
      : 1.0;
    const bestSimilarity = originalBest.similarity;

    // === AMBIGUITY GATING ===
    // Skip boosting when it won't help or isn't appropriate
    let skipReason = null;

    if (bestSimilarity >= skipBoostIfConfident) {
      skipReason = 'already_confident';
    } else if (originalMargin >= ambiguityMarginThreshold) {
      skipReason = 'clear_winner';
    } else if (bestSimilarity < minSimilarityForBoosting) {
      skipReason = 'low_similarity';
    } else if (participantNames.size === 0) {
      skipReason = 'no_hypothesis';
    }

    if (skipReason) {
      // Return original attribution unchanged, but with debug info about why we skipped
      return {
        ...originalAttribution,
        wasInfluenced: false,
        boostSkipped: true,
        skipReason,
        debug: {
          ...debug,
          boostApplied: false,
          boostSkipReason: skipReason,
          hypothesisVersion: this.hypothesis.version,
        },
      };
    }

    // === CONTENDER-ONLY BOOSTING ===
    // Only boost a participant if they're NOT already winning, or if top 2 are both participants
    const bestIsParticipant = participantNames.has(originalBest.speakerName);
    const secondIsParticipant = originalSecond && participantNames.has(originalSecond.speakerName);

    // Determine who should receive boost:
    // - If best is NOT a participant but second IS → boost second (contender)
    // - If both are participants → boost both (competitive participants)
    // - If best IS a participant and second is NOT → no boost needed (already winning)
    // - If neither is a participant → no boost (no participants in top 2)
    const shouldBoostBest = bestIsParticipant && secondIsParticipant;
    const shouldBoostSecond = !bestIsParticipant && secondIsParticipant;

    if (!shouldBoostBest && !shouldBoostSecond) {
      // No meaningful boost scenario
      return {
        ...originalAttribution,
        wasInfluenced: false,
        boostSkipped: true,
        skipReason: bestIsParticipant ? 'participant_already_winning' : 'no_participant_contender',
        debug: {
          ...debug,
          boostApplied: false,
          boostSkipReason: bestIsParticipant ? 'participant_already_winning' : 'no_participant_contender',
          hypothesisVersion: this.hypothesis.version,
        },
      };
    }

    // Apply boost selectively
    const boostedMatches = debug.allMatches.map((match, idx) => {
      const isParticipant = participantNames.has(match.speakerName);
      const isEligible = idx < boostEligibilityRank;

      let boostedSimilarity = match.similarity;
      let wasBoosted = false;

      // Only boost if eligible AND in a boost scenario
      if (isParticipant && isEligible) {
        // Boost if: both top 2 are participants, OR this is the contender (second place participant)
        const isContender = idx === 1 && shouldBoostSecond;
        const isBothParticipants = shouldBoostBest;

        if (isContender || isBothParticipants) {
          boostedSimilarity = Math.min(1.0, match.similarity * boostFactor);
          wasBoosted = true;
        }
      }

      return {
        ...match,
        originalSimilarity: match.similarity,
        similarity: boostedSimilarity,
        wasBoosted,
      };
    });

    // Re-sort by boosted similarity
    boostedMatches.sort((a, b) => b.similarity - a.similarity);

    const best = boostedMatches[0];
    const second = boostedMatches[1];

    // Determine if boosting changed the outcome
    const wasInfluenced = best.speakerName !== originalBest.speakerName;

    // Calculate new margin
    const margin = second ? best.similarity - second.similarity : 1.0;

    // Determine final attribution
    let finalSpeakerName = best.speakerName;
    let reason = 'boosted_match';

    // Still need minimum threshold even with boost
    if (best.similarity < minSimilarityAfterBoost) {
      finalSpeakerName = 'Unknown';
      reason = 'below_boost_threshold';
    }
    // Check for ambiguous match (handled separately in display)
    else if (margin < CLUSTERING_DEFAULTS.confidenceMargin && debug.allMatches.length > 1) {
      reason = 'ambiguous_boosted';
    }

    return {
      speakerName: finalSpeakerName,
      similarity: best.similarity,
      originalSimilarity: best.originalSimilarity,
      margin,
      wasInfluenced,
      boostSkipped: false,
      reason,
      debug: {
        ...debug,
        allMatches: boostedMatches,
        boostApplied: true,
        boostScenario: shouldBoostSecond ? 'contender_boosted' : 'both_participants_boosted',
        hypothesisVersion: this.hypothesis.version,
      },
    };
  }

  /**
   * Build display info from attribution
   */
  buildDisplayInfoFromAttribution(boostedAttribution, originalAttribution) {
    const {
      ambiguousDisplayThreshold,
      ambiguousMarginMax,
      unexpectedSpeakerThreshold,
    } = this.config;

    const debug = boostedAttribution.debug;
    if (!debug || !debug.allMatches || debug.allMatches.length === 0) {
      return {
        label: 'Unknown',
        alternateLabel: null,
        showAlternate: false,
        isUnexpected: false,
      };
    }

    const best = debug.allMatches[0];
    const second = debug.allMatches[1];
    const margin = boostedAttribution.margin;

    // Get participant names
    const participantNames = new Set(this.hypothesis.participants.map(p => p.speakerName));
    const isParticipant = participantNames.has(best.speakerName);

    // Check for unexpected speaker
    const isUnexpected = !isParticipant &&
      best.similarity < unexpectedSpeakerThreshold &&
      this.hypothesis.participants.length > 0;

    // Determine label
    let label = best.speakerName;
    let alternateLabel = null;
    let showAlternate = false;

    if (boostedAttribution.speakerName === 'Unknown') {
      label = 'Unknown';
    } else if (isUnexpected) {
      label = `Unexpected: ${best.speakerName}`;
    }

    // Check for ambiguous display
    if (second &&
        margin < ambiguousMarginMax &&
        best.similarity >= ambiguousDisplayThreshold &&
        second.similarity >= ambiguousDisplayThreshold) {
      // Both are plausible - show alternate
      const secondIsParticipant = participantNames.has(second.speakerName);
      if (isParticipant || secondIsParticipant) {
        alternateLabel = second.speakerName;
        showAlternate = true;
      }
    }

    return {
      label,
      alternateLabel,
      showAlternate,
      isUnexpected,
      wasInfluenced: boostedAttribution.wasInfluenced,
    };
  }

  /**
   * Build display info for cases without attribution data
   */
  buildDisplayInfo(best, second, margin) {
    return {
      label: best ? best.speakerName : 'Unknown',
      alternateLabel: null,
      showAlternate: false,
      isUnexpected: false,
    };
  }

  /**
   * Recalculate all attributions with current hypothesis
   * @returns {number[]} Indices of segments that changed
   */
  recalculateAllAttributions() {
    // First rebuild the hypothesis
    this.buildHypothesis();

    const changedIndices = [];

    for (let i = 0; i < this.segmentAttributions.length; i++) {
      const attr = this.segmentAttributions[i];
      if (!attr || !attr.originalAttribution) continue;

      const oldLabel = attr.displayInfo?.label;
      const oldAlternate = attr.displayInfo?.alternateLabel;

      // Re-apply boosting with new hypothesis
      const boostedAttribution = this.applyBoosting(attr.originalAttribution);
      const displayInfo = this.buildDisplayInfoFromAttribution(boostedAttribution, attr.originalAttribution);

      // Check if display changed
      const displayChanged = oldLabel !== displayInfo.label ||
                            oldAlternate !== displayInfo.alternateLabel;

      // Update attribution
      this.segmentAttributions[i] = {
        ...attr,
        boostedAttribution,
        displayInfo,
        hypothesisVersion: this.hypothesis.version,
        wasInfluenced: boostedAttribution.wasInfluenced,
      };

      if (displayChanged) {
        changedIndices.push(i);
      }
    }

    // Notify callback if any segments changed
    if (changedIndices.length > 0 && this.onAttributionChange) {
      this.onAttributionChange(changedIndices);
    }

    return changedIndices;
  }

  /**
   * Get current hypothesis for UI display
   */
  getHypothesis() {
    return {
      ...this.hypothesis,
      isForming: this.hypothesis.totalSegments < this.config.minSegmentsForHypothesis,
      segmentsUntilHypothesis: Math.max(0, this.config.minSegmentsForHypothesis - this.hypothesis.totalSegments),
    };
  }

  /**
   * Get attribution for a specific segment
   */
  getAttribution(index) {
    return this.segmentAttributions[index] || null;
  }

  /**
   * Reset all state (e.g., when starting new recording)
   */
  reset() {
    this.hypothesis = {
      participants: [],
      version: 0,
      totalSegments: 0,
    };
    this.segmentAttributions = [];
    this.speakerStats.clear();
    this.hypothesisHistory = [];
  }

  /**
   * Rebuild hypothesis from existing segments without re-processing attributions.
   * Used when loading saved recordings that already have inferenceAttribution data.
   *
   * This extracts statistics from segments' clustering data to rebuild:
   * - speakerStats Map (competitive counts, similarities, time series)
   * - hypothesis (participants, version, totalSegments)
   *
   * Unlike processNewSegment(), this does NOT recalculate boosting or change
   * segmentAttributions - it preserves whatever attributions are already stored.
   *
   * @param {Object[]} segments - Array of segments with debug.clustering data
   * @returns {Object} The rebuilt hypothesis
   */
  rebuildFromSegments(segments) {
    // Clear stats but preserve segmentAttributions (they were already loaded)
    this.speakerStats.clear();
    this.hypothesis = {
      participants: [],
      version: 0,
      totalSegments: 0,
    };
    this.hypothesisHistory = [];

    // Process each segment to rebuild statistics
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Skip environmental sounds
      if (segment.isEnvironmental) continue;

      // Get clustering data from segment
      const clustering = segment.debug?.clustering;
      if (!clustering?.allSimilarities || clustering.allSimilarities.length === 0) {
        continue;
      }

      // Map allSimilarities to the format expected by updateSpeakerStats
      // Note: allSimilarities from clusterer is NOT sorted - sort by similarity descending
      const allMatches = clustering.allSimilarities
        .map(s => ({
          speakerName: s.speaker,
          similarity: s.similarity,
          enrolled: s.enrolled,
        }))
        .sort((a, b) => b.similarity - a.similarity);

      // Build a minimal attribution object for updateSpeakerStats
      const attribution = {
        debug: {
          allMatches,
          similarity: clustering.similarity,
          margin: clustering.margin,
          reason: clustering.reason,
        },
      };

      // Update speaker statistics (same logic as processNewSegment)
      this.updateSpeakerStats(attribution);
      this.hypothesis.totalSegments++;
    }

    // Build the hypothesis from accumulated statistics
    if (this.hypothesis.totalSegments >= this.config.minSegmentsForHypothesis) {
      this.buildHypothesis();
    }

    return this.getHypothesis();
  }

  /**
   * Update config parameters at runtime (for tuning panel)
   * @param {Object} updates - Key-value pairs of config parameters to update
   */
  updateConfig(updates) {
    Object.assign(this.config, updates);
  }

  /**
   * Reset config to defaults
   */
  resetConfig() {
    this.config = { ...CONVERSATION_INFERENCE_DEFAULTS };
  }

  /**
   * Get current config for UI display
   * @returns {Object} Current config values
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get statistics for debugging
   */
  getStats() {
    return {
      hypothesis: this.hypothesis,
      speakerStats: Object.fromEntries(this.speakerStats),
      totalAttributions: this.segmentAttributions.length,
      config: this.config,
    };
  }

  /**
   * Feature 5: Get per-speaker statistics for UI display
   * @param {string} speakerName
   * @returns {Object|null} Stats for the speaker
   */
  getSpeakerStatsForUI(speakerName) {
    const stats = this.speakerStats.get(speakerName);
    if (!stats) return null;

    const similarities = stats.similarities;
    const runnerUpCount = stats.competitiveCount - stats.bestMatchCount;
    const minSim = similarities.length > 0 ? Math.min(...similarities) : null;
    const maxSim = similarities.length > 0 ? Math.max(...similarities) : null;

    // Calculate trend by comparing first half vs second half averages
    let trend = 'stable';
    if (similarities.length >= 4) {
      const mid = Math.floor(similarities.length / 2);
      const firstHalf = similarities.slice(0, mid);
      const secondHalf = similarities.slice(mid);
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const delta = secondAvg - firstAvg;
      const threshold = ATTRIBUTION_UI_DEFAULTS.trendThreshold;
      if (delta > threshold) trend = 'improving';
      else if (delta < -threshold) trend = 'declining';
    }

    return {
      bestMatchCount: stats.bestMatchCount,
      runnerUpCount,
      competitiveCount: stats.competitiveCount,
      minSimilarity: minSim,
      maxSimilarity: maxSim,
      avgSimilarity: similarities.length > 0
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length
        : null,
      trend,
      timeSeries: stats.timeSeries || [],
    };
  }

  /**
   * Feature 5: Get all speaker stats for participants panel
   * @returns {Object} Map of speakerName -> stats
   */
  getAllSpeakerStatsForUI() {
    const result = {};
    for (const [name] of this.speakerStats) {
      result[name] = this.getSpeakerStatsForUI(name);
    }
    return result;
  }

  /**
   * Feature 9: Get hypothesis change history
   * @returns {Array} Array of hypothesis changes
   */
  getHypothesisHistory() {
    return [...this.hypothesisHistory];
  }
}

export default ConversationInference;
