/**
 * Sherpa-ONNX Backend for Speaker Embeddings
 *
 * NOTE: This backend is a work-in-progress placeholder.
 *
 * Current status:
 * - sherpa-onnx's WASM build only exposes full diarization pipeline, not standalone embedding extraction
 * - The Node.js addon has SpeakerEmbeddingExtractor but uses native bindings, not WASM
 *
 * Future options:
 * 1. Use ONNX Runtime Web directly with manual preprocessing (mel filterbanks)
 * 2. Wait for sherpa-onnx to expose embedding extraction in their WASM build
 * 3. Convert models to Transformers.js format using HuggingFace Optimum
 *
 * For now, this backend will throw an error if used, guiding users to use Transformers.js models.
 */

import { EmbeddingBackend } from './embeddingBackend.js';

export class SherpaBackend extends EmbeddingBackend {
  constructor() {
    super();
  }

  /**
   * Load the model
   * @param {import('../../config/models.js').EmbeddingModelConfig} modelConfig
   * @param {function} [progressCallback]
   */
  async load(modelConfig, progressCallback) {
    this.modelConfig = modelConfig;

    // TODO: Implement sherpa-onnx WASM integration
    // Current blockers:
    // 1. sherpa-onnx WASM only exposes full diarization pipeline (segmentation + embedding + clustering)
    // 2. We need standalone embedding extraction to use our own phrase-based segmentation
    //
    // Options to explore:
    // - Use onnxruntime-web directly with the ONNX model files
    // - Would need to implement mel filterbank preprocessing (fbank 80-dim)
    // - Model files available at: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models

    throw new Error(
      `SherpaBackend is not yet implemented for browser use. ` +
      `Model "${modelConfig.name}" requires sherpa-onnx WASM integration which is work-in-progress. ` +
      `Please use a Transformers.js model (like WavLM) for now.`
    );
  }

  /**
   * Extract speaker embedding from audio
   * @param {Float32Array} audioFloat32
   * @returns {Promise<Float32Array|null>}
   */
  async extractEmbedding(audioFloat32) {
    if (!this.isLoaded) {
      console.error('[SherpaBackend] Model not loaded');
      return null;
    }

    // TODO: Implement embedding extraction
    // Expected API (based on sherpa-onnx Node.js addon):
    //
    // const stream = this.extractor.createStream();
    // stream.acceptWaveform({ sampleRate: 16000, samples: audioFloat32 });
    // stream.inputFinished();
    // const embedding = this.extractor.compute(stream);
    // return new Float32Array(embedding);

    throw new Error('SherpaBackend.extractEmbedding() not implemented');
  }

  /**
   * Dispose of model resources
   */
  async dispose() {
    // TODO: Clean up sherpa-onnx resources
    await super.dispose();
  }
}

/**
 * Check if sherpa-onnx is available in the current environment
 * @returns {boolean}
 */
export function isSherpaAvailable() {
  // TODO: Check for sherpa-onnx WASM module availability
  return false;
}

export default SherpaBackend;
