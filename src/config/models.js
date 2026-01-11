/**
 * Embedding Model Registry
 *
 * Defines available speaker embedding models with their backend requirements.
 * This enables experimentation with different model architectures to compare
 * performance, size, and quality tradeoffs.
 *
 * Backends:
 * - transformers-js: Uses @huggingface/transformers (current implementation)
 * - sherpa-onnx: Uses sherpa-onnx WASM package (lightweight models)
 */

/**
 * @typedef {Object} EmbeddingModelConfig
 * @property {string} id - Unique identifier for the model
 * @property {string} name - Human-readable display name
 * @property {string} source - Model source (HuggingFace ID or ONNX filename)
 * @property {number} dimensions - Output embedding dimensions
 * @property {string} size - Approximate model size for display
 * @property {'transformers-js'|'sherpa-onnx'} backend - Inference backend to use
 * @property {string} description - Brief description for UI
 * @property {string} [modelUrl] - Direct URL to model file (for sherpa-onnx models)
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
    backend: 'sherpa-onnx',
    description: 'Lightweight (13x smaller), good English performance.',
    modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
    available: false, // Backend not yet implemented for browser
  },
  'wespeaker-ecapa-tdnn': {
    id: 'wespeaker-ecapa-tdnn',
    name: 'WeSpeaker ECAPA-TDNN',
    source: 'wespeaker_en_voxceleb_CAM++.onnx',
    dimensions: 512,
    size: '~29MB',
    backend: 'sherpa-onnx',
    description: 'Lightweight, same dimensions as WavLM.',
    modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx',
    available: false, // Backend not yet implemented for browser
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
 * Check if a model uses sherpa-onnx backend
 * @param {string} modelId
 * @returns {boolean}
 */
export function isSherpaModel(modelId) {
  const config = EMBEDDING_MODELS[modelId];
  return config?.backend === 'sherpa-onnx';
}

Object.freeze(EMBEDDING_MODELS);
