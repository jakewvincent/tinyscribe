/**
 * Alpine.js Components
 * Register all Alpine components before Alpine starts
 */

document.addEventListener('alpine:init', () => {
  /**
   * Default panel order (used if no saved order exists)
   */
  const DEFAULT_PANEL_ORDER = [
    'participants',
    'phrase-stats',
    'enrollment',
    'recordings',
    'model-status',
    'debug',
    'boosting-tuning',
    'model-selection',
    'segmentation-selection',
  ];

  /**
   * Sidebar panel order store
   * Manages panel ordering with persistence and move operations
   */
  Alpine.store('sidebarOrder', {
    // Load saved order from localStorage or use default
    order: (() => {
      try {
        const saved = localStorage.getItem('sidebar-panel-order');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Validate saved order has all panels
          if (Array.isArray(parsed) && parsed.length === DEFAULT_PANEL_ORDER.length) {
            return parsed;
          }
        }
      } catch (e) {
        // Ignore localStorage errors
      }
      return [...DEFAULT_PANEL_ORDER];
    })(),

    /**
     * Save current order to localStorage
     */
    _save() {
      try {
        localStorage.setItem('sidebar-panel-order', JSON.stringify(this.order));
      } catch (e) {
        // Ignore localStorage errors
      }
    },

    /**
     * Get the CSS order value for a panel
     * @param {string} panelId - Panel identifier
     * @returns {number} CSS order value
     */
    getOrder(panelId) {
      const idx = this.order.indexOf(panelId);
      return idx >= 0 ? idx : 999;
    },

    /**
     * Check if a panel can move up
     * @param {string} panelId - Panel identifier
     * @returns {boolean}
     */
    canMoveUp(panelId) {
      return this.order.indexOf(panelId) > 0;
    },

    /**
     * Check if a panel can move down
     * @param {string} panelId - Panel identifier
     * @returns {boolean}
     */
    canMoveDown(panelId) {
      const idx = this.order.indexOf(panelId);
      return idx >= 0 && idx < this.order.length - 1;
    },

    /**
     * Move a panel up in the order
     * @param {string} panelId - Panel identifier
     */
    moveUp(panelId) {
      const idx = this.order.indexOf(panelId);
      if (idx > 0) {
        const newOrder = [...this.order];
        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
        this.order = newOrder;
        this._save();
      }
    },

    /**
     * Move a panel down in the order
     * @param {string} panelId - Panel identifier
     */
    moveDown(panelId) {
      const idx = this.order.indexOf(panelId);
      if (idx >= 0 && idx < this.order.length - 1) {
        const newOrder = [...this.order];
        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
        this.order = newOrder;
        this._save();
      }
    },

    /**
     * Reset to default order
     */
    resetOrder() {
      this.order = [...DEFAULT_PANEL_ORDER];
      this._save();
    },
  });

  /**
   * Collapsible panel component with persistence
   * Usage: x-data="panel('panel-name', true)"
   * @param {string} name - Unique panel identifier for persistence
   * @param {boolean} defaultExpanded - Initial expanded state
   */
  Alpine.data('panel', (name, defaultExpanded = true) => ({
    expanded: Alpine.$persist(defaultExpanded).as(`panel-${name}`),
    panelId: name,

    toggle() {
      this.expanded = !this.expanded;
    },

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    // Listen for programmatic collapse/expand from app.js
    init() {
      window.addEventListener('panel-collapse', (e) => {
        if (e.detail.panel === name) {
          this.expanded = false;
        }
      });
      window.addEventListener('panel-expand', (e) => {
        if (e.detail.panel === name) {
          this.expanded = true;
        }
      });
    },
  }));

  /**
   * Model Status panel component
   * Extends panel with model loading state tracking
   */
  Alpine.data('modelStatusPanel', () => ({
    expanded: false, // Always start collapsed (no persistence)
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
    panelId: 'model-status',

    toggle() {
      this.expanded = !this.expanded;
    },

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    init() {
      // Listen for model status updates from app.js
      window.addEventListener('model-status-update', (e) => {
        this.status = e.detail.status;
      });

      // Also listen for model-loaded for backwards compatibility
      window.addEventListener('model-loaded', () => {
        this.status = 'ready';
      });
    },
  }));

  /**
   * Status bar component
   * Displays app status, metrics, and processing state
   */
  Alpine.data('statusBar', () => ({
    status: 'ready',
    statusText: 'Ready',
    metrics: { asr: '-', embed: '-', total: '-' },
    bufferPercent: 0,
    chunkStatus: 'Idle',
    chunkSlots: [false, false, false, false, false], // slot states

    init() {
      // Listen for status updates from app.js
      window.addEventListener('status-update', (e) => {
        const { status, text } = e.detail;
        this.status = status;
        this.statusText = text;
      });

      window.addEventListener('metrics-update', (e) => {
        this.metrics = e.detail;
      });

      window.addEventListener('buffer-update', (e) => {
        this.bufferPercent = e.detail.percent;
      });

      window.addEventListener('chunk-queue-update', (e) => {
        this.chunkStatus = e.detail.status;
        this.chunkSlots = e.detail.slots;
      });
    },
  }));

  /**
   * Recording controls component
   * Manages recording button state and actions
   */
  Alpine.data('recordingControls', () => ({
    isRecording: false,
    modelLoaded: false,
    hasTranscript: false,

    init() {
      window.addEventListener('model-loaded', () => {
        this.modelLoaded = true;
      });

      window.addEventListener('recording-state', (e) => {
        this.isRecording = e.detail.recording;
      });

      window.addEventListener('transcript-state', (e) => {
        this.hasTranscript = e.detail.hasContent;
      });
    },

    toggleRecording() {
      window.dispatchEvent(new CustomEvent('toggle-recording'));
    },

    uploadAudio() {
      window.dispatchEvent(new CustomEvent('upload-audio'));
    },

    clearTranscript() {
      window.dispatchEvent(new CustomEvent('clear-transcript'));
    },
  }));

  /**
   * Phrase stats component
   * Displays last phrase details with speaker info
   */
  Alpine.data('phraseStats', () => ({
    phrase: {
      text: 'No phrases yet',
      speaker: '-',
      similarity: '-',
      runnerUp: '-',
      margin: '-',
      marginValue: null,
      duration: '-',
      type: '-',
    },

    get phrasePreview() {
      const text = this.phrase.text || 'No phrases yet';
      return text.length > 80 ? text.substring(0, 80) + '...' : text;
    },

    get marginClass() {
      const margin = this.phrase.marginValue;
      if (margin >= 0.15) return 'confidence-high';
      if (margin >= 0.05) return 'confidence-medium';
      if (margin > 0) return 'confidence-low';
      return '';
    },

    init() {
      window.addEventListener('phrase-update', (e) => {
        this.phrase = e.detail;
      });

      window.addEventListener('phrase-reset', () => {
        this.phrase = {
          text: 'No phrases yet',
          speaker: '-',
          similarity: '-',
          runnerUp: '-',
          margin: '-',
          marginValue: null,
          duration: '-',
          type: '-',
        };
      });
    },
  }));

  /**
   * Enrollment content component
   * Manages enrollment sidebar UI: intro -> complete states
   * (Modal handled separately in app.js)
   */
  Alpine.data('enrollmentContent', () => ({
    state: 'intro', // 'intro' | 'complete'
    speakerName: '',
    enrollments: [],
    modelLoaded: false,
    statusMessage: '',
    statusError: false,

    get enrolledCountText() {
      const count = this.enrollments.length;
      return `${count} speaker${count !== 1 ? 's' : ''} enrolled`;
    },

    init() {
      // Listen for model loaded
      window.addEventListener('model-loaded', () => {
        this.modelLoaded = true;
      });

      // Listen for enrollment list updates from app.js
      window.addEventListener('enrollments-updated', (e) => {
        this.enrollments = e.detail.enrollments;
        if (this.enrollments.length > 0 && this.state === 'intro') {
          this.state = 'complete';
        } else if (this.enrollments.length === 0) {
          this.state = 'intro';
        }
      });

      // Listen for state changes from app.js (e.g., after modal closes)
      window.addEventListener('enrollment-state-change', (e) => {
        this.state = e.detail.state;
        if (e.detail.speakerName !== undefined) {
          this.speakerName = e.detail.speakerName;
        }
      });

      // Listen for status updates
      window.addEventListener('enrollment-status', (e) => {
        this.statusMessage = e.detail.message;
        this.statusError = e.detail.isError || false;
      });
    },

    startEnrollment() {
      // Dispatch to app.js which opens the modal
      window.dispatchEvent(
        new CustomEvent('enrollment-start', {
          detail: { name: this.speakerName },
        })
      );
    },

    skip() {
      this.state = 'complete';
    },

    addNewSpeaker() {
      this.speakerName = '';
      this.state = 'intro';
    },

    removeEnrollment(id) {
      window.dispatchEvent(
        new CustomEvent('enrollment-remove', {
          detail: { id },
        })
      );
    },

    clearAll() {
      if (confirm('Are you sure you want to permanently delete *all* enrolled speakers?')) {
        window.dispatchEvent(new CustomEvent('enrollment-clear-all'));
      }
    },
  }));

  /**
   * Segment Comparison Mode component (Feature 7)
   * Allows comparing embeddings between two transcript segments
   */
  Alpine.data('comparisonMode', () => ({
    enabled: false,
    result: null,

    init() {
      // Listen for mode changes
      window.addEventListener('comparison-mode-changed', (e) => {
        this.enabled = e.detail.enabled;
        if (!this.enabled) {
          this.result = null;
        }
      });

      // Listen for comparison results
      window.addEventListener('comparison-result', (e) => {
        this.result = e.detail;
      });
    },

    toggle() {
      if (window.app) {
        window.app.toggleComparisonMode();
      }
    },

    get similarityPercent() {
      return this.result?.similarity ? Math.round(this.result.similarity * 100) : null;
    },

    get similarityClass() {
      if (!this.result?.similarity) return '';
      if (this.result.similarity >= 0.75) return 'similarity-high';
      if (this.result.similarity >= 0.5) return 'similarity-medium';
      return 'similarity-low';
    },

    get verdictText() {
      if (!this.result) return '';
      if (this.result.error) return this.result.error;
      if (this.result.sameSpeakerLikely && this.result.sameSpeakerActual) {
        return 'Same speaker (confirmed)';
      } else if (this.result.sameSpeakerLikely && !this.result.sameSpeakerActual) {
        return 'Likely same speaker (mismatch!)';
      } else if (!this.result.sameSpeakerLikely && this.result.sameSpeakerActual) {
        return 'Different embedding, same assigned speaker';
      } else {
        return 'Different speakers';
      }
    },

    get verdictClass() {
      if (!this.result || this.result.error) return 'verdict-error';
      if (this.result.sameSpeakerLikely === this.result.sameSpeakerActual) {
        return 'verdict-match';
      }
      return 'verdict-mismatch';
    },
  }));

  /**
   * Recordings Panel component
   * Manages list of saved recordings, playback controls, and viewing state
   */
  Alpine.data('recordingsPanel', () => ({
    expanded: Alpine.$persist(true).as('panel-recordings'),
    panelId: 'recordings',
    recordings: [],
    selectedId: null,
    isViewingRecording: false,
    viewedRecording: null,
    isPlaying: false,
    playbackTime: 0,
    playbackDuration: 0,
    enrollmentSource: 'snapshot', // 'snapshot' or 'current'
    isRenaming: null, // ID of recording being renamed
    renameValue: '',

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    init() {
      // Listen for recordings list updates
      window.addEventListener('recordings-updated', (e) => {
        this.recordings = e.detail.recordings;
      });

      // Listen for recording loaded
      window.addEventListener('recording-loaded', (e) => {
        this.isViewingRecording = true;
        this.viewedRecording = e.detail;
        this.selectedId = e.detail.id;
        this.playbackDuration = e.detail.duration;
        this.playbackTime = 0;
        this.isPlaying = false;
      });

      // Listen for recording closed
      window.addEventListener('recording-closed', () => {
        this.isViewingRecording = false;
        this.viewedRecording = null;
        this.selectedId = null;
        this.isPlaying = false;
        this.playbackTime = 0;
      });

      // Listen for playback progress (future)
      window.addEventListener('playback-progress', (e) => {
        this.playbackTime = e.detail.time;
        this.isPlaying = e.detail.playing;
      });
    },

    toggle() {
      this.expanded = !this.expanded;
    },

    // Format duration for display
    formatDuration(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    // Format file size for display
    formatSize(bytes) {
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    },

    // Format date for display
    formatDate(timestamp) {
      return new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    // Load a recording
    loadRecording(id) {
      window.dispatchEvent(new CustomEvent('recording-load', { detail: { id } }));
    },

    // Return to live mode
    returnToLive() {
      window.dispatchEvent(new CustomEvent('recording-return-to-live'));
    },

    // Start renaming a recording
    startRename(id, currentName) {
      this.isRenaming = id;
      this.renameValue = currentName;
      // Focus input after Alpine updates DOM
      this.$nextTick(() => {
        const input = document.querySelector('.rename-input');
        if (input) {
          input.focus();
          input.select();
        }
      });
    },

    // Confirm rename
    confirmRename() {
      if (this.isRenaming && this.renameValue.trim()) {
        window.dispatchEvent(new CustomEvent('recording-rename', {
          detail: { id: this.isRenaming, name: this.renameValue.trim() },
        }));
      }
      this.isRenaming = null;
      this.renameValue = '';
    },

    // Cancel rename
    cancelRename() {
      this.isRenaming = null;
      this.renameValue = '';
    },

    // Delete a recording
    deleteRecording(id) {
      if (confirm('Delete this recording? This cannot be undone.')) {
        window.dispatchEvent(new CustomEvent('recording-delete', { detail: { id } }));
      }
    },

    // Toggle playback
    togglePlay() {
      window.dispatchEvent(new CustomEvent('playback-toggle'));
    },

    // Download the current recording as WAV
    downloadRecording() {
      if (!this.selectedId) return;
      window.dispatchEvent(new CustomEvent('recording-download', {
        detail: { id: this.selectedId },
      }));
    },

    // Set enrollment source and trigger re-clustering
    setEnrollmentSource(source) {
      if (source === this.enrollmentSource) return;
      this.enrollmentSource = source;
      window.dispatchEvent(new CustomEvent('enrollment-source-change', {
        detail: { source },
      }));
    },
  }));

  /**
   * Boosting Tuning Panel component
   * Allows live adjustment of boosting parameters for experimentation
   */
  Alpine.data('boostingTuningPanel', () => ({
    expanded: Alpine.$persist(false).as('panel-boosting-tuning'),
    panelId: 'boosting-tuning',

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    // Tunable parameters (will be populated from defaults)
    boostFactor: 1.10,
    boostEligibilityRank: 2,
    ambiguityMarginThreshold: 0.18,
    skipBoostIfConfident: 0.82,
    minSimilarityForBoosting: 0.65,
    minSimilarityAfterBoost: 0.75,

    // Store defaults for reset
    defaults: {
      boostFactor: 1.10,
      boostEligibilityRank: 2,
      ambiguityMarginThreshold: 0.18,
      skipBoostIfConfident: 0.82,
      minSimilarityForBoosting: 0.65,
      minSimilarityAfterBoost: 0.75,
    },

    init() {
      // Listen for config loaded from app.js
      window.addEventListener('boosting-config-loaded', (e) => {
        const config = e.detail;
        this.boostFactor = config.boostFactor ?? this.defaults.boostFactor;
        this.boostEligibilityRank = config.boostEligibilityRank ?? this.defaults.boostEligibilityRank;
        this.ambiguityMarginThreshold = config.ambiguityMarginThreshold ?? this.defaults.ambiguityMarginThreshold;
        this.skipBoostIfConfident = config.skipBoostIfConfident ?? this.defaults.skipBoostIfConfident;
        this.minSimilarityForBoosting = config.minSimilarityForBoosting ?? this.defaults.minSimilarityForBoosting;
        this.minSimilarityAfterBoost = config.minSimilarityAfterBoost ?? this.defaults.minSimilarityAfterBoost;

        // Update defaults from loaded config
        Object.assign(this.defaults, config);
      });
    },

    toggle() {
      this.expanded = !this.expanded;
    },

    updateParam(param, value) {
      // Parse value to appropriate type
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        this[param] = numValue;
        window.dispatchEvent(new CustomEvent('boosting-config-update', {
          detail: { [param]: numValue },
        }));
      }
    },

    resetDefaults() {
      this.boostFactor = this.defaults.boostFactor;
      this.boostEligibilityRank = this.defaults.boostEligibilityRank;
      this.ambiguityMarginThreshold = this.defaults.ambiguityMarginThreshold;
      this.skipBoostIfConfident = this.defaults.skipBoostIfConfident;
      this.minSimilarityForBoosting = this.defaults.minSimilarityForBoosting;
      this.minSimilarityAfterBoost = this.defaults.minSimilarityAfterBoost;

      window.dispatchEvent(new CustomEvent('boosting-config-reset'));
    },

    // Format value for display
    formatValue(value, decimals = 2) {
      return typeof value === 'number' ? value.toFixed(decimals) : value;
    },
  }));

  /**
   * Model Selection component
   * Allows switching between embedding models (requires page reload)
   */
  Alpine.data('modelSelection', () => ({
    expanded: Alpine.$persist(false).as('panel-model-selection'),
    panelId: 'model-selection',
    models: [],
    selectedModel: '',
    isLoading: false,

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    init() {
      // Get model config from window (set by main.js)
      // main.js is a module that runs after Alpine, so listen for the event
      if (window.embeddingModels) {
        this.loadModels();
      }
      window.addEventListener('embedding-models-ready', () => this.loadModels());
    },

    loadModels() {
      if (window.embeddingModels) {
        this.models = window.embeddingModels.available;
        this.selectedModel = window.embeddingModels.selected;
      }
    },

    toggle() {
      this.expanded = !this.expanded;
    },

    changeModel(modelId) {
      if (modelId === this.selectedModel || !modelId) return;

      // Confirm since this will reload the page
      if (confirm('Changing models will reload the page. Continue?')) {
        this.isLoading = true;
        window.embeddingModels.setModel(modelId);
      }
    },

    // Get display info for current model
    get currentModelInfo() {
      return this.models.find(m => m.id === this.selectedModel) || null;
    },
  }));

  /**
   * Segmentation Selection component
   * Allows switching between segmentation methods (requires page reload)
   * Also provides model-specific parameter tuning with live updates
   */
  Alpine.data('segmentationSelection', () => ({
    expanded: Alpine.$persist(false).as('panel-segmentation-selection'),
    panelId: 'segmentation-selection',
    models: [],
    selectedModel: '',
    isLoading: false,

    // Model-specific params
    params: {},         // Current param values
    paramConfigs: {},   // Param metadata (min/max/step/label/description)
    defaults: {},       // Default values for reset

    // Panel order helpers (delegate to store)
    get order() {
      return Alpine.store('sidebarOrder').getOrder(this.panelId);
    },
    get canMoveUp() {
      return Alpine.store('sidebarOrder').canMoveUp(this.panelId);
    },
    get canMoveDown() {
      return Alpine.store('sidebarOrder').canMoveDown(this.panelId);
    },
    moveUp() {
      Alpine.store('sidebarOrder').moveUp(this.panelId);
    },
    moveDown() {
      Alpine.store('sidebarOrder').moveDown(this.panelId);
    },

    init() {
      // Get model config from window (set by main.js)
      if (window.segmentationModels) {
        this.loadModels();
      }
      window.addEventListener('segmentation-models-ready', () => this.loadModels());
    },

    loadModels() {
      if (window.segmentationModels) {
        this.models = window.segmentationModels.available;
        this.selectedModel = window.segmentationModels.selected;

        // Load params for current model
        this.loadParams();
      }
    },

    loadParams() {
      if (!window.segmentationModels) return;

      const modelId = this.selectedModel;
      this.params = window.segmentationModels.getParams(modelId) || {};
      this.paramConfigs = window.segmentationModels.getParamConfigs(modelId) || {};
      this.defaults = window.segmentationModels.getDefaults(modelId) || {};
    },

    toggle() {
      this.expanded = !this.expanded;
    },

    changeModel(modelId) {
      if (modelId === this.selectedModel || !modelId) return;

      // Confirm since this will reload the page
      if (confirm('Changing segmentation model will reload the page. Continue?')) {
        this.isLoading = true;
        window.segmentationModels.setModel(modelId);
      }
    },

    // Update a single param value
    updateParam(key, value) {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) return;

      this.params[key] = numValue;

      // Persist to storage
      if (window.segmentationModels) {
        window.segmentationModels.setParam(this.selectedModel, key, numValue);
      }

      // Notify worker to update in real-time
      window.dispatchEvent(new CustomEvent('segmentation-param-update', {
        detail: { key, value: numValue, modelId: this.selectedModel },
      }));
    },

    // Reset all params to defaults
    resetParams() {
      if (window.segmentationModels) {
        window.segmentationModels.resetParams(this.selectedModel);
        this.loadParams();

        // Notify worker of reset
        window.dispatchEvent(new CustomEvent('segmentation-params-reset', {
          detail: { modelId: this.selectedModel, params: this.params },
        }));
      }
    },

    // Check if any params differ from defaults
    get hasCustomParams() {
      for (const key of Object.keys(this.defaults)) {
        if (this.params[key] !== this.defaults[key]) return true;
      }
      return false;
    },

    // Get param keys as array for iteration
    get paramKeys() {
      return Object.keys(this.paramConfigs);
    },

    // Format value for display
    formatValue(key, value) {
      const config = this.paramConfigs[key];
      if (!config) return value;

      // Format to appropriate precision based on step
      const step = config.step || 0.01;
      const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
      const formatted = parseFloat(value).toFixed(decimals);
      return config.unit ? `${formatted}${config.unit}` : formatted;
    },

    // Get display info for current model
    get currentModelInfo() {
      return this.models.find(m => m.id === this.selectedModel) || null;
    },
  }));
});
