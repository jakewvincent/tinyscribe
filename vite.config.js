import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  // Enable Web Workers with ES module format
  worker: {
    format: 'es',
  },

  // Plugins
  plugins: [
    viteStaticCopy({
      targets: [
        // VAD model and worklet files
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: 'vad',
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
          dest: 'vad',
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
          dest: 'vad',
        },
        // ONNX runtime WASM files
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'vad',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.mjs',
          dest: 'vad',
        },
      ],
    }),
  ],

  // Treat ONNX files as assets
  assetsInclude: ['**/*.onnx'],

  // Development server with cross-origin isolation headers
  // These are REQUIRED for SharedArrayBuffer and WASM multithreading
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Proxy for ONNX model downloads (bypasses CORS during development)
    proxy: {
      // Embedding models from sherpa-onnx
      '/models/sherpa-onnx': {
        target: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/models\/sherpa-onnx/, ''),
        followRedirects: true,
      },
      // Segmentation models from sherpa-onnx
      '/models/segmentation': {
        target: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/models\/segmentation/, ''),
        followRedirects: true,
      },
    },
  },

  // Production preview with same headers
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Optimize dependencies - exclude problematic packages
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },

  build: {
    target: 'esnext',
  },
});
