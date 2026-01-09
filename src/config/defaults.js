/**
 * Default Configuration
 * Central location for all configurable constants used across modules
 */

// Speaker clustering configuration
// Note: WavLM-SV baseline is ~0.62 for different speakers, ~0.96 for same speaker
export const CLUSTERING_DEFAULTS = {
  // Similarity threshold for confident speaker matching (cosine similarity)
  similarityThreshold: 0.75,
  // Below this, assign to Unknown (don't force match)
  minimumSimilarityThreshold: 0.5,
  // Minimum margin between best and second-best match for confidence
  confidenceMargin: 0.15,
  // Threshold for warning about similar enrolled speakers (above WavLM baseline of ~0.62)
  interEnrollmentWarningThreshold: 0.72,
};

// Conversation-level speaker inference configuration
export const CONVERSATION_INFERENCE_DEFAULTS = {
  // Hypothesis building
  minSegmentsForHypothesis: 3, // Need 3+ segments before forming hypothesis
  participantConfidenceThreshold: 0.70, // Min avg similarity to be hypothesized
  participantMinOccurrences: 2, // Min segments where speaker is competitive

  // Boosting
  boostFactor: 1.10, // 10% boost for hypothesized participants
  boostEligibilityRank: 2, // Must be in top N to receive boost
  minSimilarityAfterBoost: 0.75, // Still need this minimum even with boost

  // Ambiguous display (show "Speaker1 (Speaker2?)" format)
  ambiguousDisplayThreshold: 0.70, // Both candidates must be above this
  ambiguousMarginMax: 0.12, // Show alternate if margin below this

  // Unexpected speaker detection
  unexpectedSpeakerThreshold: 0.70, // Below this for non-participant = unexpected
};

// VAD (Voice Activity Detection) configuration
export const VAD_DEFAULTS = {
  // Speech duration constraints (seconds)
  minSpeechDuration: 1.0,
  maxSpeechDuration: 15.0,
  // Overlap duration prepended to chunks (seconds)
  overlapDuration: 1.5,
  // VAD model settings
  model: 'legacy', // 'legacy' or 'v5' (v5 has issues with subsequent segments)
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 300,
  preSpeechPadMs: 250,
};

// Phrase detection configuration
export const PHRASE_DEFAULTS = {
  // Gap threshold that triggers phrase boundary (seconds)
  gapThreshold: 0.200,
  // Minimum phrase duration for reliable embedding (seconds)
  minPhraseDuration: 0.5,
  // WavLM frame rate (frames per second)
  frameRate: 50,
};

// Overlap merging configuration
export const OVERLAP_MERGER_DEFAULTS = {
  // Similarity threshold for text matching
  similarityThreshold: 0.8,
  // Minimum words to consider a valid match
  minMatchLength: 2,
};

// Enrollment configuration
export const ENROLLMENT_DEFAULTS = {
  // Minimum samples required to complete enrollment
  minSamplesRequired: 3,
  // Similarity threshold for outlier detection during centroid computation
  outlierThreshold: 0.7,
  // Maximum number of enrolled speakers
  maxEnrolledSpeakers: 6,
};

// Rainbow Passage - phonetically balanced sentences for enrollment
export const RAINBOW_PASSAGES = [
  // Group 1: Sentences 1-2 (~29 words)
  'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors.',

  // Group 2: Sentences 3-4 (~35 words)
  'These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end.',

  // Group 3: Sentences 5-6 (~30 words)
  'People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow.',
];

// Audio validation configuration
export const VALIDATION_DEFAULTS = {
  // Clipping detection
  clippingThreshold: 0.99,
  clippingRatioLimit: 0.001, // 0.1% of samples

  // RMS energy bounds
  rmsMin: 0.01,
  rmsMax: 0.5,

  // Speech content requirements
  minSpeechDuration: 5.0, // seconds
  minSpeechRatio: 0.5, // 50%

  // Transcription matching
  transcriptionMatchThreshold: 0.7, // 70% word overlap

  // Energy-based speech detection
  energyFrameSize: 512, // ~32ms at 16kHz
  energyThreshold: 0.02,

  // VAD-based validation
  minVadSpeechDuration: 5.0, // seconds
};

// Sound classification patterns
export const SOUND_CLASSIFICATION = {
  // Human voice sounds - can be attributed to a speaker
  humanVoicePatterns: [
    'laugh', 'chuckle', 'giggle', 'cough', 'sigh', 'sneeze', 'cry', 'sob',
    'scream', 'groan', 'moan', 'yawn', 'gasp', 'breath', 'hum', 'whistle',
    'sing', 'clear', 'throat', 'hiccup', 'snore', 'sniff', 'whimper',
  ],

  // Environmental sounds - should NOT be attributed to a speaker
  environmentalPatterns: [
    'blank', 'music', 'noise', 'applause', 'silence', 'static', 'beep',
    'ring', 'click', 'bang', 'crash', 'thunder', 'rain', 'wind', 'door',
    'phone', 'alarm', 'siren', 'horn', 'engine', 'background',
  ],
};

// Debug logging configuration
export const DEBUG_DEFAULTS = {
  // Maximum sessions to keep (auto-cleanup older)
  maxSessions: 5,
};

// Attribution UI configuration (for hypothesis visibility features)
export const ATTRIBUTION_UI_DEFAULTS = {
  // Similarity breakdown bar
  maxCandidatesToShow: 4,
  minSimilarityToShow: 0.3,

  // Trend detection
  trendThreshold: 0.05, // Similarity difference to classify as improving/declining

  // Comparison mode
  comparisonEnabled: true,
};

// Decision reason badges for clustering outcomes
export const REASON_BADGES = {
  confident_match: { label: 'Confident', cssClass: 'reason-confident' },
  ambiguous_match: { label: 'Ambiguous', cssClass: 'reason-ambiguous' },
  below_minimum_threshold: { label: 'Below Min', cssClass: 'reason-below' },
  new_speaker: { label: 'New', cssClass: 'reason-new' },
  inherited: { label: 'Inherited', cssClass: 'reason-inherited' },
  no_embedding: { label: 'No Embed', cssClass: 'reason-nodata' },
  no_confident_match: { label: 'Uncertain', cssClass: 'reason-uncertain' },
  boosted_match: { label: 'Boosted', cssClass: 'reason-boosted' },
};

// Speaker colors for UI display
export const SPEAKER_COLORS = [
  '#4a90d9', // Blue
  '#2ecc71', // Green
  '#e74c3c', // Red
  '#9b59b6', // Purple
  '#f39c12', // Orange
  '#1abc9c', // Teal
];

// Combined defaults export for convenience
export const DEFAULTS = {
  clustering: CLUSTERING_DEFAULTS,
  vad: VAD_DEFAULTS,
  phrase: PHRASE_DEFAULTS,
  overlapMerger: OVERLAP_MERGER_DEFAULTS,
  enrollment: ENROLLMENT_DEFAULTS,
  validation: VALIDATION_DEFAULTS,
  soundClassification: SOUND_CLASSIFICATION,
  speakerColors: SPEAKER_COLORS,
  rainbowPassages: RAINBOW_PASSAGES,
  debug: DEBUG_DEFAULTS,
  attributionUI: ATTRIBUTION_UI_DEFAULTS,
  reasonBadges: REASON_BADGES,
};

export default DEFAULTS;
