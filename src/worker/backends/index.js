/**
 * Embedding Backends
 *
 * Exports all available embedding backends for speaker embeddings.
 *
 * Backends:
 * - TransformersBackend: Uses @huggingface/transformers (WavLM models)
 * - OnnxBackend: Uses onnxruntime-web with mel filterbank preprocessing (3D-Speaker, WeSpeaker models)
 */

export { EmbeddingBackend } from './embeddingBackend.js';
export { TransformersBackend } from './transformersBackend.js';
export { OnnxBackend } from './onnxBackend.js';
