/**
 * Application Entry Point
 * Initializes the transcription app when DOM is ready
 */

import { App } from './app.js';
import './styles.css';
import { getAvailableEmbeddingModels, DEFAULT_EMBEDDING_MODEL } from './config/models.js';
import { ModelSelectionStore } from './storage/index.js';

// Expose model configuration for Alpine components
window.embeddingModels = {
  available: getAvailableEmbeddingModels(),
  selected: ModelSelectionStore.getEmbeddingModel(),
  defaultModel: DEFAULT_EMBEDDING_MODEL,
  setModel(modelId) {
    ModelSelectionStore.setEmbeddingModel(modelId);
    window.location.reload();
  },
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Check for required browser features
  if (!checkBrowserSupport()) {
    return;
  }

  // Create and expose app instance
  window.app = new App();
});

/**
 * Check if the browser supports required features
 */
function checkBrowserSupport() {
  const errors = [];

  // Check for Web Workers
  if (typeof Worker === 'undefined') {
    errors.push('Web Workers are not supported');
  }

  // Check for getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    errors.push('MediaDevices API is not supported');
  }

  // Check for AudioContext
  if (!window.AudioContext && !window.webkitAudioContext) {
    errors.push('Web Audio API is not supported');
  }

  // Check for SharedArrayBuffer (needed for WASM threading)
  if (typeof SharedArrayBuffer === 'undefined') {
    errors.push(
      'SharedArrayBuffer is not available. This may be due to missing cross-origin isolation headers. ' +
        'Make sure the server sends "Cross-Origin-Opener-Policy: same-origin" and ' +
        '"Cross-Origin-Embedder-Policy: require-corp" headers.'
    );
  }

  if (errors.length > 0) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="panel" style="background: #fef2f2; border-color: #fecaca;">
        <h2 style="color: #dc2626;">Browser Compatibility Issues</h2>
        <p>This application requires a modern browser with the following features:</p>
        <ul style="margin: 1rem 0; padding-left: 1.5rem;">
          ${errors.map((e) => `<li style="margin-bottom: 0.5rem;">${e}</li>`).join('')}
        </ul>
        <p><strong>Recommended:</strong> Use the latest version of Chrome, Edge, or Firefox.</p>
        <p style="margin-top: 1rem; font-size: 0.875rem; color: #6b7280;">
          If you're running this locally, make sure to use <code>npm run dev</code> to start the development server
          with the required headers.
        </p>
      </div>
    `;
    return false;
  }

  return true;
}
