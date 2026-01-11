/**
 * Embedding Backends
 *
 * Exports all available embedding backends for speaker embeddings.
 */

export { EmbeddingBackend } from './embeddingBackend.js';
export { TransformersBackend } from './transformersBackend.js';
export { SherpaBackend, isSherpaAvailable } from './sherpaBackend.js';
