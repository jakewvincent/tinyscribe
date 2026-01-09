/**
 * Core module barrel export
 * Pure logic modules with no browser dependencies
 */

// Embedding utilities and clustering
export {
  l2Normalize,
  l2NormalizeCopy,
  cosineSimilarity,
  SpeakerClusterer,
  UNKNOWN_SPEAKER_ID,
  PCAProjector,
} from './embedding/index.js';

// Transcription processing
export {
  PhraseDetector,
  OverlapMerger,
  TranscriptMerger,
} from './transcription/index.js';

// Sound classification
export { SoundClassifier, SoundType } from './sound/index.js';

// Validation utilities
export { AudioValidator } from './validation/index.js';

// Conversation-level inference
export { ConversationInference } from './inference/index.js';
