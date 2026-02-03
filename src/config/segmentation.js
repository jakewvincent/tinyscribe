/**
 * Segmentation Model Registry
 *
 * Defines available speaker segmentation models with their backend requirements.
 * This enables experimentation with different segmentation approaches to compare
 * text-based (phrase gap) vs acoustic (pyannote/reverb) speaker boundary detection.
 *
 * Backends:
 * - text-gap: Uses Whisper word timestamps and gap detection (no model required)
 * - transformers-js: Uses @huggingface/transformers for HuggingFace ONNX models
 * - onnx: Uses onnxruntime-web directly for raw ONNX files (sherpa-onnx models)
 */

/**
 * @typedef {Object} ParamConfig
 * @property {number} default - Default value
 * @property {number} min - Minimum value
 * @property {number} max - Maximum value
 * @property {number} step - Step increment
 * @property {string} label - Display label
 * @property {string} description - Tooltip description
 * @property {string} [unit] - Unit label (e.g., 'ms', 's')
 * @property {function} [format] - Custom format function for display
 */

/**
 * @typedef {Object} SegmentationModelConfig
 * @property {string} id - Unique identifier for the model
 * @property {string} name - Human-readable display name
 * @property {'text-gap'|'transformers-js'|'onnx'} backend - Inference backend to use
 * @property {string} [source] - Model source (HuggingFace ID or ONNX URL/path)
 * @property {string} size - Approximate model size for display
 * @property {string} description - Brief description for UI
 * @property {number} [maxSpeakers] - Max speakers model can detect per chunk (null = unlimited)
 * @property {boolean} [available] - Whether the model is available (default: true)
 * @property {Record<string, ParamConfig>} [params] - Tunable parameters for this model
 */

/**
 * Available segmentation models
 * @type {Record<string, SegmentationModelConfig>}
 */
export const SEGMENTATION_MODELS = {
  'phrase-gap': {
    id: 'phrase-gap',
    name: 'Text-based Phrase Gap',
    backend: 'text-gap',
    size: '0 MB',
    description: 'Current default. Uses Whisper word timing gaps to segment.',
    maxSpeakers: null,
    params: {
      gapThreshold: {
        default: 0.200,
        min: 0.050,
        max: 1.000,
        step: 0.025,
        label: 'Gap Threshold',
        description: 'Minimum silence between words to start a new phrase. Whisper provides word timestamps; this threshold determines when pauses indicate a potential speaker boundary. Lower = more phrases (finer granularity), higher = fewer but longer phrases.',
        unit: 's',
      },
      minPhraseDuration: {
        default: 0.500,
        min: 0.100,
        max: 2.000,
        step: 0.100,
        label: 'Min Phrase Duration',
        description: 'Phrases shorter than this are discarded before embedding extraction. Very short audio clips lack enough voice information for reliable speaker identification. 0.5s is typically the minimum for stable embeddings.',
        unit: 's',
      },
    },
  },
  'pyannote-seg-3': {
    id: 'pyannote-seg-3',
    name: 'Pyannote Segmentation 3.0',
    backend: 'transformers-js',
    source: 'onnx-community/pyannote-segmentation-3.0',
    size: '~6 MB',
    description: 'Acoustic segmentation. Detects speaker boundaries from audio.',
    maxSpeakers: 3,
    params: {
      minSegmentDuration: {
        default: 0.0,
        min: 0.0,
        max: 2.0,
        step: 0.1,
        label: 'Min Segment Duration',
        description: 'Filter out speaker segments shorter than this. Acoustic models may detect brief spurious segments; this removes noise. Higher = fewer but longer segments, lower = keeps short utterances like "yeah" or "uh-huh".',
        unit: 's',
      },
      segmentPadding: {
        default: 0.0,
        min: 0.0,
        max: 1.0,
        step: 0.05,
        label: 'Segment Padding',
        description: 'Extends segment boundaries outward by this amount. Useful when model boundaries are too tight and clip the start/end of speech. Also helps adjacent same-speaker segments merge together.',
        unit: 's',
      },
      mergeGapThreshold: {
        default: 0.5,
        min: 0.0,
        max: 2.0,
        step: 0.1,
        label: 'Merge Gap Threshold',
        description: 'When two consecutive segments belong to the same speaker and the gap between them is smaller than this, merge them into one longer segment. Reduces over-segmentation from brief pauses.',
        unit: 's',
      },
      minConfidence: {
        default: 0.0,
        min: 0.0,
        max: 0.9,
        step: 0.05,
        label: 'Min Confidence',
        description: 'Acoustic models output confidence scores for speech detection. Segments below this threshold are discarded. 0 = keep all. Note: this is speech detection confidence, not speaker identity confidence.',
        unit: '',
      },
    },
  },
  'reverb-diarization-v1': {
    id: 'reverb-diarization-v1',
    name: 'Reverb Diarization v1',
    backend: 'onnx',
    // Model hosted on HuggingFace (originally from sherpa-onnx)
    source: 'https://huggingface.co/jakewvincent/reverb-diarization-v1-onnx/resolve/main/model.onnx',
    size: '~9 MB',
    description: 'Fine-tuned pyannote. 16.5% better WDER than baseline.',
    maxSpeakers: 3,
    params: {
      minSegmentDuration: {
        default: 0.0,
        min: 0.0,
        max: 2.0,
        step: 0.1,
        label: 'Min Segment Duration',
        description: 'Filter out speaker segments shorter than this. Acoustic models may detect brief spurious segments; this removes noise. Higher = fewer but longer segments, lower = keeps short utterances like "yeah" or "uh-huh".',
        unit: 's',
      },
      segmentPadding: {
        default: 0.0,
        min: 0.0,
        max: 1.0,
        step: 0.05,
        label: 'Segment Padding',
        description: 'Extends segment boundaries outward by this amount. Useful when model boundaries are too tight and clip the start/end of speech. Also helps adjacent same-speaker segments merge together.',
        unit: 's',
      },
      mergeGapThreshold: {
        default: 0.5,
        min: 0.0,
        max: 2.0,
        step: 0.1,
        label: 'Merge Gap Threshold',
        description: 'When two consecutive segments belong to the same speaker and the gap between them is smaller than this, merge them into one longer segment. Reduces over-segmentation from brief pauses.',
        unit: 's',
      },
      minConfidence: {
        default: 0.0,
        min: 0.0,
        max: 0.9,
        step: 0.05,
        label: 'Min Confidence',
        description: 'Acoustic models output confidence scores for speech detection. Segments below this threshold are discarded. 0 = keep all. Note: this is speech detection confidence, not speaker identity confidence.',
        unit: '',
      },
    },
  },
};

/**
 * Default model to use when none is selected
 */
export const DEFAULT_SEGMENTATION_MODEL = 'pyannote-seg-3';

/**
 * Get model config by ID, with fallback to default
 * @param {string} modelId
 * @returns {SegmentationModelConfig}
 */
export function getSegmentationModelConfig(modelId) {
  return SEGMENTATION_MODELS[modelId] || SEGMENTATION_MODELS[DEFAULT_SEGMENTATION_MODEL];
}

/**
 * Get all models as array (for UI dropdowns)
 * @param {boolean} [onlyAvailable=true] - If true, only return models with available backends
 * @returns {SegmentationModelConfig[]}
 */
export function getAvailableSegmentationModels(onlyAvailable = true) {
  const models = Object.values(SEGMENTATION_MODELS);
  if (onlyAvailable) {
    return models.filter(m => m.available !== false);
  }
  return models;
}

/**
 * Get default parameter values for a model
 * @param {string} modelId
 * @returns {Record<string, number>} Object with param keys and their default values
 */
export function getDefaultSegmentationParams(modelId) {
  const config = SEGMENTATION_MODELS[modelId];
  if (!config?.params) return {};

  const defaults = {};
  for (const [key, paramConfig] of Object.entries(config.params)) {
    defaults[key] = paramConfig.default;
  }
  return defaults;
}

/**
 * Get parameter metadata for a model (for building UI)
 * @param {string} modelId
 * @returns {Record<string, ParamConfig>|null} Parameter configs or null if none
 */
export function getSegmentationParamConfigs(modelId) {
  const config = SEGMENTATION_MODELS[modelId];
  return config?.params || null;
}

Object.freeze(SEGMENTATION_MODELS);
