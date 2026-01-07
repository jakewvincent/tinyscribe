import { defineConfig } from 'vite';

export default defineConfig({
  // Enable Web Workers with ES module format
  worker: {
    format: 'es',
  },

  // Development server with cross-origin isolation headers
  // These are REQUIRED for SharedArrayBuffer and WASM multithreading
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Production preview with same headers
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Optimize dependencies - exclude transformers to avoid bundling issues
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },

  build: {
    target: 'esnext',
  },
});
