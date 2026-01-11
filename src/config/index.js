/**
 * Configuration barrel export
 */

export {
  DEFAULTS,
  CLUSTERING_DEFAULTS,
  VAD_DEFAULTS,
  PHRASE_DEFAULTS,
  OVERLAP_MERGER_DEFAULTS,
  ENROLLMENT_DEFAULTS,
  VALIDATION_DEFAULTS,
  SOUND_CLASSIFICATION,
  SPEAKER_COLORS,
  RAINBOW_PASSAGES,
} from './defaults.js';

export {
  EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingModelConfig,
  getAvailableEmbeddingModels,
  isOnnxModel,
} from './models.js';

export {
  SEGMENTATION_MODELS,
  DEFAULT_SEGMENTATION_MODEL,
  getSegmentationModelConfig,
  getAvailableSegmentationModels,
  getDefaultSegmentationParams,
  getSegmentationParamConfigs,
} from './segmentation.js';
