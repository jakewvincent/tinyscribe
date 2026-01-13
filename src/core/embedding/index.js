/**
 * Embedding module barrel export
 */

export {
  l2Normalize,
  l2NormalizeCopy,
  cosineSimilarity,
} from './embeddingUtils.js';

export {
  SpeakerClusterer,
  UNKNOWN_SPEAKER_ID,
} from './speakerClusterer.js';

export { PCAProjector } from './pcaProjector.js';

export {
  computeMeanPairwiseSimilarity,
  computeMinPairwiseSimilarity,
  computeSilhouetteScore,
  computeDiscriminabilityMetrics,
} from './discriminabilityMetrics.js';
