/**
 * Transformers.js Backend for Speaker Embeddings
 *
 * Wraps Hugging Face Transformers.js for speaker embedding extraction.
 * Currently supports WavLM models.
 */

import { AutoProcessor, AutoModel } from '@huggingface/transformers';
import { EmbeddingBackend } from './embeddingBackend.js';

export class TransformersBackend extends EmbeddingBackend {
  constructor() {
    super();
    this.processor = null;
    this.model = null;
  }

  /**
   * Load the model using Transformers.js
   * @param {import('../../config/models.js').EmbeddingModelConfig} modelConfig
   * @param {function} [progressCallback]
   */
  async load(modelConfig, progressCallback) {
    this.modelConfig = modelConfig;

    const modelId = modelConfig.source;

    // Load processor
    this.processor = await AutoProcessor.from_pretrained(modelId, {
      progress_callback: progressCallback,
    });

    // Load model - always use WASM with fp32 for accurate frame-level features
    this.model = await AutoModel.from_pretrained(modelId, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: progressCallback,
    });

    this.isLoaded = true;
    console.log(`[TransformersBackend] Loaded ${modelConfig.name} (${modelConfig.dimensions}-dim)`);
  }

  /**
   * Extract speaker embedding from audio
   * @param {Float32Array} audioFloat32 - Audio samples at 16kHz
   * @returns {Promise<Float32Array|null>}
   */
  async extractEmbedding(audioFloat32) {
    if (!this.isLoaded) {
      console.error('[TransformersBackend] Model not loaded');
      return null;
    }

    try {
      // Process audio through model
      const inputs = await this.processor(audioFloat32);
      const output = await this.model(inputs);

      // WavLM-SV models output embeddings directly with shape [1, embedding_dim]
      const embeddings = output.embeddings;
      if (!embeddings) {
        console.error('[TransformersBackend] No embeddings in model output. Keys:', Object.keys(output));
        return null;
      }

      // Diagnostic logging
      const raw = embeddings.data;
      let norm = 0, min = Infinity, max = -Infinity, sum = 0;
      for (let i = 0; i < raw.length; i++) {
        norm += raw[i] * raw[i];
        sum += raw[i];
        if (raw[i] < min) min = raw[i];
        if (raw[i] > max) max = raw[i];
      }
      console.log(
        `[TransformersBackend] dim=${raw.length}, norm=${Math.sqrt(norm).toFixed(4)}, ` +
        `mean=${(sum / raw.length).toFixed(6)}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`
      );

      return new Float32Array(embeddings.data);
    } catch (error) {
      console.error('[TransformersBackend] Embedding extraction error:', error);
      return null;
    }
  }

  /**
   * Dispose of model resources
   */
  async dispose() {
    // Transformers.js models may have dispose methods
    if (this.model && typeof this.model.dispose === 'function') {
      await this.model.dispose();
    }
    if (this.processor && typeof this.processor.dispose === 'function') {
      await this.processor.dispose();
    }
    this.model = null;
    this.processor = null;
    await super.dispose();
  }
}

export default TransformersBackend;
