/**
 * Application Entry Point
 * Initializes the transcription app when DOM is ready
 */

import { App } from './app.js';
import './styles.css';
import { getAvailableEmbeddingModels, DEFAULT_EMBEDDING_MODEL } from './config/models.js';
import {
  getAvailableSegmentationModels,
  DEFAULT_SEGMENTATION_MODEL,
  getDefaultSegmentationParams,
  getSegmentationParamConfigs,
} from './config/segmentation.js';
import { ModelSelectionStore, SegmentationModelStore } from './storage/index.js';

// Migrate old segmentation model default to new default
SegmentationModelStore.migrateOldDefaults();

// Register custom elements
import './ui/components/tooltip.js';

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

window.segmentationModels = {
  available: getAvailableSegmentationModels(),
  selected: SegmentationModelStore.getSegmentationModel(),
  defaultModel: DEFAULT_SEGMENTATION_MODEL,
  setModel(modelId) {
    SegmentationModelStore.setSegmentationModel(modelId);
    window.location.reload();
  },
  // Param getters/setters for tuning
  getParams(modelId) {
    return SegmentationModelStore.getParams(modelId);
  },
  setParam(modelId, key, value) {
    return SegmentationModelStore.setParam(modelId, key, value);
  },
  resetParams(modelId) {
    return SegmentationModelStore.resetParams(modelId);
  },
  getParamConfigs(modelId) {
    return getSegmentationParamConfigs(modelId);
  },
  getDefaults(modelId) {
    return getDefaultSegmentationParams(modelId);
  },
};

// Notify Alpine components that model data is ready
// (main.js is a module that runs after Alpine's deferred scripts)
window.dispatchEvent(new CustomEvent('embedding-models-ready'));
window.dispatchEvent(new CustomEvent('segmentation-models-ready'));

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
 * Detect if the browser is Safari
 */
function isSafari() {
  const ua = navigator.userAgent;
  // Safari includes "Safari" but not "Chrome" or "Chromium" (which also include "Safari" in UA)
  return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
}

/**
 * Show Safari compatibility warning modal
 */
function showSafariWarning() {
  const modalId = 'safari-warning-modal';

  // Don't show if already dismissed this session
  if (sessionStorage.getItem('safari-warning-dismissed')) {
    return;
  }

  const dismissModal = () => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      setTimeout(() => modal.remove(), 200);
    }
    sessionStorage.setItem('safari-warning-dismissed', 'true');
  };

  // Expose dismiss function globally for onclick
  window.dismissSafariWarning = dismissModal;

  const modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal-overlay hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 480px;">
      <div class="modal-header">
        <h2>Safari Not Recommended</h2>
      </div>
      <div class="modal-body" style="margin-bottom: var(--space-lg);">
        <p style="margin: 0 0 1rem 0; line-height: 1.6;">
          This experimental app relies on audio processing libraries that have
          known compatibility issues with Safari. You may experience problems
          with speech detection not working or the app getting stuck.
        </p>
        <p style="margin: 0; line-height: 1.6;">
          For the best experience, please use <strong>Chrome</strong>, <strong>Edge</strong>,
          or <strong>Firefox</strong>.
        </p>
      </div>
      <div class="modal-actions" style="justify-content: flex-end;">
        <button class="btn btn-primary" onclick="window.dismissSafariWarning()">
          Continue Anyway
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Trigger animation by removing hidden class after append
  requestAnimationFrame(() => {
    modal.classList.remove('hidden');
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      dismissModal();
    }
  });

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      dismissModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

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

  // Show warning for Safari users (non-blocking)
  if (isSafari()) {
    // Defer to allow app container to be ready
    setTimeout(showSafariWarning, 0);
  }

  return true;
}
