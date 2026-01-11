/**
 * Embedding Model Registry
 *
 * Defines available speaker embedding models with their backend requirements.
 * This enables experimentation with different model architectures to compare
 * performance, size, and quality tradeoffs.
 *
 * Backends:
 * - transformers-js: Uses @huggingface/transformers (WavLM models)
 * - onnx: Uses onnxruntime-web directly with mel filterbank preprocessing
 */

/**
 * @typedef {Object} EmbeddingModelConfig
 * @property {string} id - Unique identifier for the model
 * @property {string} name - Human-readable display name
 * @property {string} source - Model source (HuggingFace ID or ONNX filename)
 * @property {number} dimensions - Output embedding dimensions
 * @property {string} size - Approximate model size for display
 * @property {'transformers-js'|'onnx'} backend - Inference backend to use
 * @property {string} description - Brief description for UI
 * @property {string} [modelUrl] - Direct URL to model file (for ONNX models)
 * @property {boolean} [available] - Whether the model is available (default: true)
 */

/**
 * Available embedding models
 * @type {Record<string, EmbeddingModelConfig>}
 */
export const EMBEDDING_MODELS = {
  'wavlm-base-sv': {
    id: 'wavlm-base-sv',
    name: 'WavLM Base+ SV',
    source: 'Xenova/wavlm-base-plus-sv',
    dimensions: 512,
    size: '~360MB',
    backend: 'transformers-js',
    description: 'High quality, large model. Current default.',
  },
  '3dspeaker-eres2net': {
    id: '3dspeaker-eres2net',
    name: '3D-Speaker ERes2Net',
    source: '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
    dimensions: 192,
    size: '~26.5MB',
    backend: 'onnx',
    description: 'Lightweight (13x smaller), good English performance.',
    modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
  },
  'wespeaker-campp': {
    id: 'wespeaker-campp',
    name: 'WeSpeaker CAM++',
    source: 'wespeaker_en_voxceleb_CAM++.onnx',
    dimensions: 512,
    size: '~29MB',
    backend: 'onnx',
    description: 'Lightweight, same dimensions as WavLM.',
    modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx',
  },
};

/**
 * Default model to use when none is selected
 */
export const DEFAULT_EMBEDDING_MODEL = 'wavlm-base-sv';

/**
 * Get model config by ID, with fallback to default
 * @param {string} modelId
 * @returns {EmbeddingModelConfig}
 */
export function getEmbeddingModelConfig(modelId) {
  return EMBEDDING_MODELS[modelId] || EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL];
}

/**
 * Get all models as array (for UI dropdowns)
 * @param {boolean} [onlyAvailable=true] - If true, only return models with available backends
 * @returns {EmbeddingModelConfig[]}
 */
export function getAvailableEmbeddingModels(onlyAvailable = true) {
  const models = Object.values(EMBEDDING_MODELS);
  if (onlyAvailable) {
    return models.filter(m => m.available !== false);
  }
  return models;
}

/**
 * Check if a model uses ONNX Runtime Web backend
 * @param {string} modelId
 * @returns {boolean}
 */
export function isOnnxModel(modelId) {
  const config = EMBEDDING_MODELS[modelId];
  return config?.backend === 'onnx';
}

Object.freeze(EMBEDDING_MODELS);
