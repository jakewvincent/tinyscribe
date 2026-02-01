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
   * Job UI store
   * Manages job-related UI state (sidebars, etc.)
   */
  Alpine.store('jobUI', {
    participantsSidebarOpen: (() => {
      try {
        const saved = localStorage.getItem('job-participants-sidebar');
        return saved === 'true';
      } catch (e) {
        return false;
      }
    })(),

    toggleParticipants() {
      this.participantsSidebarOpen = !this.participantsSidebarOpen;
      try {
        localStorage.setItem('job-participants-sidebar', String(this.participantsSidebarOpen));
      } catch (e) {
        // Ignore localStorage errors
      }
    },
  });

  /**
   * Theme store
   * Manages visual theme selection with persistence
   */
  Alpine.store('theme', {
    available: [
      { id: '', name: 'Default', description: 'Clean, modern interface' },
      { id: 'neumorphism', name: 'Neumorphism', description: 'Soft, extruded UI' },
      { id: 'neo-memphis', name: 'Neo-Memphis', description: 'Bold, playful, 80s inspired' },
      { id: 'neobrutalist', name: 'Neobrutalist', description: 'Raw, harsh, monospace' },
      { id: 'glassmorphism', name: 'Glassmorphism', description: 'Frosted glass on gradient' },
    ],

    current: (() => {
      // Load and apply theme immediately to prevent flash
      let themeId = 'glassmorphism';
      try {
        const stored = localStorage.getItem('app-theme');
        if (stored !== null) {
          themeId = stored;
        }
      } catch (e) {
        // Ignore
      }
      // Apply immediately
      if (themeId) {
        document.documentElement.setAttribute('data-theme', themeId);
      }
      return themeId;
    })(),

    _apply(themeId) {
      if (themeId) {
        document.documentElement.setAttribute('data-theme', themeId);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    },

    set(themeId) {
      this.current = themeId;
      this._apply(themeId);
      try {
        if (themeId) {
          localStorage.setItem('app-theme', themeId);
        } else {
          localStorage.removeItem('app-theme');
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    },

    getCurrentName() {
      const theme = this.available.find(t => t.id === this.current);
      return theme?.name || 'Default';
    },
  });

  /**
   * Live Mode store
   * Tracks whether we're in live recording mode vs viewing a saved recording.
   * Also holds the live job when in live mode.
   */
  Alpine.store('liveMode', {
    isLiveMode: true,
    liveJob: null,
    isRecording: false,

    init() {
      // Listen for live job updates from app.js
      window.addEventListener('live-job-updated', (e) => {
        this.liveJob = e.detail.job;
        this.isLiveMode = e.detail.isLiveMode;
        this.isRecording = e.detail.isRecording;
      });

      // When a recording is loaded, we're no longer in live mode
      window.addEventListener('recording-loaded', () => {
        this.isLiveMode = false;
      });

      // When recording is closed, we're back in live mode
      window.addEventListener('recording-closed', () => {
        this.isLiveMode = true;
      });
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

    // Model status (moved from modelStatusPanel)
    modelStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
    modelPopoverOpen: false,

    // Debug status
    debugPopoverOpen: false,
    debugEnabled: false,
    debugVerbose: false,
    debugStatusText: 'Logging disabled',

    toggleModelPopover() {
      this.modelPopoverOpen = !this.modelPopoverOpen;
      if (this.modelPopoverOpen) this.debugPopoverOpen = false;
    },

    toggleDebugPopover() {
      this.debugPopoverOpen = !this.debugPopoverOpen;
      if (this.debugPopoverOpen) this.modelPopoverOpen = false;
    },

    toggleDebug(enabled) {
      this.debugEnabled = enabled;
      window.dispatchEvent(new CustomEvent('debug-toggle', { detail: { enabled } }));
    },

    toggleVerbose(verbose) {
      this.debugVerbose = verbose;
      window.dispatchEvent(new CustomEvent('debug-verbose-toggle', { detail: { verbose } }));
    },

    exportDebugLog() {
      window.dispatchEvent(new CustomEvent('debug-export'));
    },

    clearDebugLog() {
      window.dispatchEvent(new CustomEvent('debug-clear'));
    },

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

      // Model status updates
      window.addEventListener('model-status-update', (e) => {
        this.modelStatus = e.detail.status;
      });

      window.addEventListener('model-loaded', () => {
        this.modelStatus = 'ready';
      });

      // Debug status updates
      window.addEventListener('debug-status-update', (e) => {
        this.debugEnabled = e.detail.enabled ?? this.debugEnabled;
        this.debugVerbose = e.detail.verbose ?? this.debugVerbose;
        this.debugStatusText = e.detail.statusText ?? this.debugStatusText;
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
   * Audio Inputs component
   * Manages dual audio input configuration in topbar
   */
  Alpine.data('audioInputs', () => ({
    inputs: Alpine.$persist([
      { id: 0, deviceId: '', expectedSpeakers: 2 }
    ]).as('audio-inputs'),
    devices: [],
    maxInputs: 2,
    isRecording: false,
    isLoadingDevices: false,
    permissionState: 'unknown', // 'unknown', 'prompt', 'granted', 'denied'
    popoverOpen: false,

    init() {
      // Check initial permission state without prompting
      this.checkPermissionState();

      // Try to load devices (will prompt for permission if needed)
      this.loadDevices();

      // Listen for device changes from browser
      if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener('devicechange', () => this.loadDevices());
      }

      // Listen for devices-updated event (fired after successful getUserMedia anywhere in app)
      window.addEventListener('devices-updated', (e) => {
        if (e.detail?.devices) {
          this.devices = e.detail.devices;
          this.permissionState = 'granted';
        }
      });

      // Listen for recording state
      window.addEventListener('recording-state', (e) => {
        this.isRecording = e.detail.recording;
        // Re-enumerate after recording starts (permission definitely granted)
        if (e.detail.recording && this.devices.length === 0) {
          this.loadDevices();
        }
      });

      // Listen for requests to re-send audio input config (e.g., when returning from viewing recording)
      window.addEventListener('request-audio-inputs', () => {
        this.dispatchChange();
      });

      // Dispatch initial config to app.js after short delay (ensure app.js is ready)
      setTimeout(() => this.dispatchChange(), 100);
    },

    async checkPermissionState() {
      // Check permission state without triggering prompt
      try {
        if (navigator.permissions) {
          const result = await navigator.permissions.query({ name: 'microphone' });
          this.permissionState = result.state; // 'granted', 'denied', or 'prompt'
          // Listen for permission changes
          result.addEventListener('change', () => {
            this.permissionState = result.state;
            if (result.state === 'granted') {
              this.loadDevices();
            }
          });
        }
      } catch (e) {
        // permissions.query may not be supported for microphone in all browsers
        this.permissionState = 'unknown';
      }
    },

    async loadDevices() {
      if (this.isLoadingDevices) return;
      this.isLoadingDevices = true;

      try {
        // Try to get devices - this may prompt for permission
        const devices = await window.getAudioInputDevices?.() || [];
        this.devices = devices;
        if (devices.length > 0) {
          this.permissionState = 'granted';
        }
      } catch (e) {
        console.warn('[audioInputs] Failed to load devices:', e);
        this.devices = [];
      } finally {
        this.isLoadingDevices = false;
      }
    },

    async refreshDevices() {
      await this.loadDevices();
    },

    get canAddInput() {
      return this.inputs.length < this.maxInputs;
    },

    availableDevicesFor(inputId) {
      const usedDevices = this.inputs
        .filter(i => i.id !== inputId)
        .map(i => i.deviceId)
        .filter(Boolean);
      return this.devices.filter(d => !usedDevices.includes(d.deviceId));
    },

    addInput() {
      if (!this.canAddInput) return;
      this.inputs.push({
        id: Date.now(),
        deviceId: '',
        expectedSpeakers: 1, // Default to 1 for second input (common use case)
      });
      this.dispatchChange();
    },

    removeInput(id) {
      if (this.inputs.length <= 1) return;
      this.inputs = this.inputs.filter(i => i.id !== id);
      this.dispatchChange();
    },

    dispatchChange() {
      window.dispatchEvent(new CustomEvent('audio-inputs-change', {
        detail: { inputs: this.inputs }
      }));
    },

    togglePopover() {
      this.popoverOpen = !this.popoverOpen;
    },

    closePopover() {
      this.popoverOpen = false;
    },
  }));

  /**
   * Speakers Button component
   * Shows enrolled count in topbar
   */
  Alpine.data('speakersButton', () => ({
    enrollments: [],

    get buttonText() {
      const count = this.enrollments.length;
      return count > 0 ? `Speakers (${count})` : 'Speakers';
    },

    init() {
      // Listen for enrollment updates
      window.addEventListener('enrollments-updated', (e) => {
        this.enrollments = e.detail.enrollments || [];
      });
    },

    openModal() {
      window.dispatchEvent(new CustomEvent('speakers-modal-open'));
    },
  }));

  /**
   * Speakers Modal component
   * Manages speaker enrollment through modal interface
   */
  Alpine.data('speakersModal', () => ({
    isOpen: false,
    enrollments: [],
    modelLoaded: false,
    isAdding: false,
    newSpeakerName: '',
    statusMessage: '',
    statusError: false,
    // Visualization model selection
    visualizationModels: [],
    selectedVisualizationModel: null,
    visualizationLoading: false,
    // Discriminability metrics
    visualizationMetrics: null,

    get currentModelName() {
      if (!this.selectedVisualizationModel) return null;
      const model = this.visualizationModels.find(m => m.id === this.selectedVisualizationModel);
      return model?.name || this.selectedVisualizationModel;
    },

    get currentModelInfo() {
      if (!this.selectedVisualizationModel) return null;
      return this.visualizationModels.find(m => m.id === this.selectedVisualizationModel);
    },

    init() {
      // Listen for open request
      window.addEventListener('speakers-modal-open', () => {
        this.isOpen = true;
        this.isAdding = false;
        this.newSpeakerName = '';
        this.statusMessage = '';
        this.statusError = false;
        // Notify app.js to update canvas
        this.$nextTick(() => {
          window.dispatchEvent(new CustomEvent('speakers-modal-opened'));
        });
      });

      // Listen for close request
      window.addEventListener('speakers-modal-close', () => {
        this.close();
      });

      // Listen for model loaded
      window.addEventListener('model-loaded', () => {
        this.modelLoaded = true;
      });

      // Listen for enrollment updates
      window.addEventListener('enrollments-updated', (e) => {
        this.enrollments = e.detail.enrollments || [];
      });

      // Listen for visualization models update
      window.addEventListener('visualization-models-updated', (e) => {
        this.visualizationModels = e.detail.models || [];
        // Select first model if none selected
        if (this.visualizationModels.length > 0 && !this.selectedVisualizationModel) {
          this.selectedVisualizationModel = this.visualizationModels[0].id;
        }
      });

      // Listen for visualization loading state
      window.addEventListener('visualization-loading', (e) => {
        this.visualizationLoading = e.detail.loading;
      });

      // Listen for metrics updates
      window.addEventListener('visualization-metrics-updated', (e) => {
        this.visualizationMetrics = e.detail.metrics;
      });

      // Listen for enrollment complete (after recording modal)
      window.addEventListener('enrollment-complete', () => {
        // Re-open speakers modal to show updated list
        this.isOpen = true;
        this.isAdding = false;
        this.newSpeakerName = '';
        // Update visualization
        this.$nextTick(() => {
          window.dispatchEvent(new CustomEvent('speakers-modal-opened'));
        });
      });

      // Listen for status updates
      window.addEventListener('enrollment-status', (e) => {
        this.statusMessage = e.detail.message;
        this.statusError = e.detail.isError || false;
      });
    },

    changeVisualizationModel(modelId) {
      this.selectedVisualizationModel = modelId;
      window.dispatchEvent(new CustomEvent('visualization-model-change', {
        detail: { modelId }
      }));
    },

    recalculateEmbeddings() {
      if (!this.selectedVisualizationModel) return;
      window.dispatchEvent(new CustomEvent('visualization-recalculate', {
        detail: { modelId: this.selectedVisualizationModel }
      }));
    },

    close() {
      this.isOpen = false;
      this.isAdding = false;
      this.newSpeakerName = '';
      // Notify app.js to clean up visualization resources
      window.dispatchEvent(new CustomEvent('speakers-modal-closed'));
    },

    startAdd() {
      this.isAdding = true;
      this.newSpeakerName = '';
      this.$nextTick(() => {
        const input = document.getElementById('new-speaker-name');
        if (input) input.focus();
      });
    },

    cancelAdd() {
      this.isAdding = false;
      this.newSpeakerName = '';
    },

    startEnrollment() {
      if (!this.newSpeakerName.trim()) return;
      // Close speakers modal before opening recording modal
      this.isOpen = false;
      this.isAdding = false;
      // Dispatch to app.js which opens the recording modal
      window.dispatchEvent(new CustomEvent('enrollment-start', {
        detail: { name: this.newSpeakerName.trim() },
      }));
    },

    removeEnrollment(id) {
      window.dispatchEvent(new CustomEvent('enrollment-remove', {
        detail: { id },
      }));
    },

    clearAll() {
      if (confirm('Remove all enrolled speakers? This cannot be undone.')) {
        window.dispatchEvent(new CustomEvent('enrollment-clear-all'));
      }
    },
  }));

  /**
   * Enrollment content component (LEGACY - keeping for sidebar compatibility during migration)
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
   * Playback Bar component
   * Controls for playing back saved recordings
   */
  Alpine.data('playbackBar', () => ({
    isViewingRecording: false,
    isPlaying: false,
    playbackTime: 0,
    playbackDuration: 0,
    enrollmentSource: 'snapshot',
    recordingId: null,

    get progressPercent() {
      if (this.playbackDuration <= 0) return 0;
      return (this.playbackTime / this.playbackDuration) * 100;
    },

    init() {
      // Listen for recording loaded
      window.addEventListener('recording-loaded', (e) => {
        this.isViewingRecording = true;
        this.playbackDuration = e.detail.duration || 0;
        this.playbackTime = 0;
        this.isPlaying = false;
        this.recordingId = e.detail.id;
      });

      // Listen for recording closed
      window.addEventListener('recording-closed', () => {
        this.isViewingRecording = false;
        this.isPlaying = false;
        this.playbackTime = 0;
        this.playbackDuration = 0;
        this.recordingId = null;
      });

      // Listen for playback progress
      window.addEventListener('playback-progress', (e) => {
        this.playbackTime = e.detail.time;
        this.isPlaying = e.detail.playing;
      });
    },

    togglePlay() {
      window.dispatchEvent(new CustomEvent('playback-toggle'));
    },

    seek(event) {
      const container = event.currentTarget;
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const percent = clickX / rect.width;
      const seekTime = percent * this.playbackDuration;
      window.dispatchEvent(new CustomEvent('playback-seek', {
        detail: { time: seekTime },
      }));
    },

    setEnrollmentSource(source) {
      if (source === this.enrollmentSource) return;
      this.enrollmentSource = source;
      window.dispatchEvent(new CustomEvent('enrollment-source-change', {
        detail: { source },
      }));
    },

    downloadRecording() {
      if (!this.recordingId) return;
      window.dispatchEvent(new CustomEvent('recording-download', {
        detail: { id: this.recordingId },
      }));
    },

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
  }));

  /**
   * Recordings Dropdown component (top bar)
   * Lightweight dropdown for quick access to recordings
   */
  Alpine.data('recordingsDropdown', () => ({
    isOpen: false,
    recordings: [],
    selectedId: null,
    isViewingRecording: false,
    viewedRecording: null,

    get buttonText() {
      if (this.isViewingRecording && this.viewedRecording) {
        return this.viewedRecording.name;
      }
      const count = this.recordings.length;
      return count > 0 ? `Recordings (${count})` : 'Recordings';
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
        this.isOpen = false; // Close dropdown after loading
      });

      // Listen for recording closed
      window.addEventListener('recording-closed', () => {
        this.isViewingRecording = false;
        this.viewedRecording = null;
        this.selectedId = null;
      });
    },

    toggle() {
      this.isOpen = !this.isOpen;
    },

    close() {
      this.isOpen = false;
    },

    loadRecording(id) {
      window.dispatchEvent(new CustomEvent('recording-load', { detail: { id } }));
    },

    returnToLive() {
      window.dispatchEvent(new CustomEvent('recording-return-to-live'));
      this.isOpen = false;
    },

    deleteRecording(id) {
      if (confirm('Delete this recording? This cannot be undone.')) {
        window.dispatchEvent(new CustomEvent('recording-delete', { detail: { id } }));
      }
    },

    formatDuration(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatDate(timestamp) {
      return new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
  }));

  /**
   * Recordings Panel component (LEGACY - sidebar panel)
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
   * Job Navigation component
   * Handles job switching, creation, editing, and settings sidebar toggle
   * Displayed in transcript header when viewing a recording
   */
  Alpine.data('jobNavigation', () => ({
    // Job state
    jobs: [],
    activeJobId: null,
    activeJob: null,

    // UI state
    dropdownOpen: false,
    editPopoverOpen: false,
    deleteConfirmOpen: false,
    settingsSidebarOpen: Alpine.$persist(false).as('job-settings-sidebar'),

    // Edit state
    editName: '',
    editNotes: '',

    // Processing state
    isProcessing: false,
    processingProgress: { current: 0, total: 0, mode: null },

    init() {
      // Listen for recording loaded with job data
      window.addEventListener('recording-loaded', (e) => {
        this.jobs = e.detail.jobs || [];
        this.activeJobId = e.detail.activeJobId;
        this.activeJob = e.detail.activeJob || null;
        this.editName = this.activeJob?.name || '';
        this.editNotes = this.activeJob?.notes || '';
        this.dropdownOpen = false;
        this.editPopoverOpen = false;
        this.deleteConfirmOpen = false;

        // Auto-open settings for unprocessed jobs
        if (this.activeJob?.status === 'unprocessed') {
          this.settingsSidebarOpen = true;
        }

        // Sync settings sidebar state with jobSettingsPanel
        // (settingsSidebarOpen may be restored from localStorage)
        window.dispatchEvent(new CustomEvent('job-settings-toggle', {
          detail: { open: this.settingsSidebarOpen },
        }));
      });

      // Listen for recording closed - restore live job if available
      window.addEventListener('recording-closed', () => {
        const store = Alpine.store('liveMode');
        if (store.liveJob) {
          // Restore live job as active
          this.jobs = [store.liveJob];
          this.activeJobId = store.liveJob.id;
          this.activeJob = store.liveJob;
        } else {
          this.jobs = [];
          this.activeJobId = null;
          this.activeJob = null;
        }
        this.dropdownOpen = false;
        this.editPopoverOpen = false;
        this.deleteConfirmOpen = false;
      });

      // Listen for live job updates (live mode only)
      window.addEventListener('live-job-updated', (e) => {
        if (e.detail.isLiveMode) {
          this.jobs = [e.detail.job];
          this.activeJobId = e.detail.job.id;
          this.activeJob = e.detail.job;
          this.editName = e.detail.job?.name || '';
          this.editNotes = e.detail.job?.notes || '';
        }
      });

      // Listen for job creation (auto-open settings)
      window.addEventListener('job-created', (e) => {
        if (e.detail.isUnprocessed) {
          this.settingsSidebarOpen = true;
          window.dispatchEvent(new CustomEvent('job-settings-toggle', {
            detail: { open: true },
          }));
        }
      });

      // Listen for job processing events
      window.addEventListener('job-processing-start', (e) => {
        this.isProcessing = true;
        this.processingProgress = { current: 0, total: 0, mode: e.detail.mode };
      });

      window.addEventListener('job-processing-progress', (e) => {
        this.processingProgress = e.detail;
      });

      window.addEventListener('job-processing-complete', () => {
        this.isProcessing = false;
        this.processingProgress = { current: 0, total: 0, mode: null };
      });

      // Close dropdowns when clicking outside
      document.addEventListener('click', (e) => {
        if (this.dropdownOpen && !e.target.closest('.job-dropdown-container')) {
          this.dropdownOpen = false;
        }
        if (this.editPopoverOpen && !e.target.closest('.job-edit-popover-container')) {
          this.editPopoverOpen = false;
        }
        if (this.deleteConfirmOpen && !e.target.closest('.job-delete-confirm-container')) {
          this.deleteConfirmOpen = false;
        }
      });
    },

    // Navigation
    get currentIndex() {
      return this.jobs.findIndex(j => j.id === this.activeJobId);
    },

    get canGoPrev() {
      return this.currentIndex > 0;
    },

    get canGoNext() {
      return this.currentIndex < this.jobs.length - 1;
    },

    goPrev() {
      if (this.canGoPrev) {
        const prevJob = this.jobs[this.currentIndex - 1];
        this.switchToJob(prevJob.id);
      }
    },

    goNext() {
      if (this.canGoNext) {
        const nextJob = this.jobs[this.currentIndex + 1];
        this.switchToJob(nextJob.id);
      }
    },

    // Job switching
    switchToJob(jobId) {
      if (jobId === this.activeJobId) {
        this.dropdownOpen = false;
        return;
      }
      this.dropdownOpen = false;
      window.dispatchEvent(new CustomEvent('job-switch', { detail: { jobId } }));
    },

    // Job creation
    createNewJob() {
      window.dispatchEvent(new CustomEvent('job-create-new'));
    },

    cloneJob() {
      if (!this.activeJobId) return;
      window.dispatchEvent(new CustomEvent('job-clone', {
        detail: { sourceJobId: this.activeJobId },
      }));
    },

    // Job deletion
    confirmDelete() {
      this.deleteConfirmOpen = true;
    },

    cancelDelete() {
      this.deleteConfirmOpen = false;
    },

    deleteJob() {
      if (!this.activeJobId) return;
      this.deleteConfirmOpen = false;
      window.dispatchEvent(new CustomEvent('job-delete', {
        detail: { jobId: this.activeJobId },
      }));
    },

    // Edit popover
    openEditPopover() {
      this.editName = this.activeJob?.name || '';
      this.editNotes = this.activeJob?.notes || '';
      this.editPopoverOpen = true;
    },

    closeEditPopover() {
      this.editPopoverOpen = false;
    },

    saveEdit() {
      if (!this.activeJobId) return;

      // Update name if changed (mark as customized so auto-naming won't override it)
      const newName = this.editName.trim();
      if (newName && newName !== this.activeJob?.name) {
        window.dispatchEvent(new CustomEvent('job-update-name', {
          detail: { jobId: this.activeJobId, name: newName, customized: true },
        }));
        if (this.activeJob) {
          this.activeJob.name = newName;
          this.activeJob.nameCustomized = true;
        }
      }

      // Update notes if changed
      if (this.editNotes !== this.activeJob?.notes) {
        window.dispatchEvent(new CustomEvent('job-update-notes', {
          detail: { jobId: this.activeJobId, notes: this.editNotes },
        }));
        if (this.activeJob) this.activeJob.notes = this.editNotes;
      }

      this.editPopoverOpen = false;
    },

    // Processing
    processJob(mode = 'quick') {
      if (!this.activeJobId) return;
      window.dispatchEvent(new CustomEvent('job-process', {
        detail: { jobId: this.activeJobId, mode },
      }));
    },

    // Settings sidebar
    toggleSettings() {
      this.settingsSidebarOpen = !this.settingsSidebarOpen;
      window.dispatchEvent(new CustomEvent('job-settings-toggle', {
        detail: { open: this.settingsSidebarOpen },
      }));
    },

    // Participants sidebar (uses store for cross-component access)
    get participantsSidebarOpen() {
      return Alpine.store('jobUI').participantsSidebarOpen;
    },

    toggleParticipants() {
      Alpine.store('jobUI').toggleParticipants();
    },

    // Copy job JSON to clipboard
    copyJobJson() {
      if (!this.activeJob || this.activeJob.status !== 'processed') return;
      window.dispatchEvent(new CustomEvent('job-copy-json', {
        detail: { jobId: this.activeJobId },
      }));
    },

    // Export job transcript
    exportJob() {
      if (!this.activeJob || this.activeJob.status !== 'processed') return;
      window.dispatchEvent(new CustomEvent('job-export', {
        detail: { jobId: this.activeJobId },
      }));
    },

    // Dropdown toggle
    toggleDropdown() {
      this.dropdownOpen = !this.dropdownOpen;
    },

    // Live mode helpers
    get isLiveMode() {
      return Alpine.store('liveMode').isLiveMode;
    },

    get isLiveJob() {
      return this.isLiveMode && this.activeJob?.status === 'live';
    },

    get isRecordingActive() {
      return Alpine.store('liveMode').isRecording;
    },

    // Helper methods
    get jobCount() {
      return this.jobs.length;
    },

    get canDelete() {
      // Can't delete live job, can't delete when only 1 job, can't delete during processing
      return !this.isLiveJob && this.jobs.length > 1 && !this.isProcessing;
    },

    get isActiveJobProcessed() {
      return this.activeJob?.status === 'processed';
    },

    get isActiveJobUnprocessed() {
      return this.activeJob?.status === 'unprocessed';
    },

    get isActiveJobProcessing() {
      return this.activeJob?.status === 'processing' || this.isProcessing;
    },

    get isActiveJobLive() {
      return this.activeJob?.status === 'live';
    },

    // Format job status for display
    formatStatus(status) {
      if (status === 'live') return 'Live';
      if (status === 'processed') return 'Processed';
      if (status === 'processing') return 'Processing...';
      return 'Unprocessed';
    },

    // Get status class for badge
    getStatusClass(status) {
      if (status === 'live') return 'status-live';
      if (status === 'processed') return 'status-processed';
      if (status === 'processing') return 'status-processing';
      return 'status-unprocessed';
    },

    // Get short settings summary for dropdown items
    getSettingsSummary(job) {
      if (!job?.settings) return '';
      const embed = job.settings.embeddingModel?.name?.replace(' SV', '').replace('Base+ ', '') || '?';
      const seg = job.settings.segmentationModel?.name?.replace('Text-based ', '').replace(' Heuristic', '') || '?';
      return `${embed} • ${seg}`;
    },

    // Check if job has notes
    hasNotes(job) {
      return Boolean(job?.notes?.trim());
    },

    // Format date
    formatDate(timestamp) {
      if (!timestamp) return '';
      return new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
  }));

  /**
   * Job Settings Panel component
   * Displays job settings in sidebar, editable for unprocessed jobs
   */
  Alpine.data('jobSettingsPanel', () => ({
    // Job state (synced with jobNavigation)
    activeJob: null,
    isVisible: false,

    // Tab state
    activeTab: 'speaker', // 'model' or 'speaker' - default to speaker for quick boosting access

    // Editable settings (for unprocessed jobs)
    settings: {
      // Models
      embeddingModelId: 'wavlm-base-sv',
      segmentationModelId: 'phrase-gap',
      // Segmentation params (dynamic based on model)
      segmentationParams: {},
      // Clustering
      similarityThreshold: 0.75,
      confidenceMargin: 0.15,
      numSpeakers: 2,
      // Boosting
      boostFactor: 1.10,
      boostEligibilityRank: 2,
      ambiguityMarginThreshold: 0.18,
      skipBoostIfConfident: 0.82,
      minSimilarityForBoosting: 0.65,
      minSimilarityAfterBoost: 0.75,
    },

    // Saved boosting settings (for dirty detection on processed jobs)
    savedBoostingSettings: null,

    // Available models (populated on init)
    embeddingModels: [],
    segmentationModels: [],

    // Segmentation param configs for current model
    segmentationParamConfigs: {},

    // Processing state
    isProcessing: false,

    // Re-applying boosting state
    isReapplying: false,

    init() {
      // Load available models
      if (window.embeddingModels) {
        this.embeddingModels = window.embeddingModels.available || [];
      }
      if (window.segmentationModels) {
        this.segmentationModels = window.segmentationModels.available || [];
        this.loadSegmentationParamConfigs();
      }

      // Listen for models ready
      window.addEventListener('embedding-models-ready', () => {
        if (window.embeddingModels) {
          this.embeddingModels = window.embeddingModels.available || [];
        }
      });
      window.addEventListener('segmentation-models-ready', () => {
        if (window.segmentationModels) {
          this.segmentationModels = window.segmentationModels.available || [];
          this.loadSegmentationParamConfigs();
        }
      });

      // Listen for recording loaded
      window.addEventListener('recording-loaded', (e) => {
        this.activeJob = e.detail.activeJob || null;
        this.syncSettingsFromJob();

        // Auto-show for unprocessed
        if (this.activeJob?.status === 'unprocessed') {
          this.isVisible = true;
        }
      });

      // Listen for recording closed - restore live job if available
      window.addEventListener('recording-closed', () => {
        const store = Alpine.store('liveMode');
        if (store.liveJob) {
          this.activeJob = store.liveJob;
          this.syncSettingsFromJob();
          this.isVisible = true;
        } else {
          this.activeJob = null;
          this.isVisible = false;
        }
      });

      // Listen for live job updates
      window.addEventListener('live-job-updated', (e) => {
        if (e.detail.isLiveMode) {
          this.activeJob = e.detail.job;
          this.syncSettingsFromJob();
          // Show settings sidebar in live mode
          this.isVisible = true;
        }
      });

      // Listen for job switched
      window.addEventListener('job-switched', (e) => {
        this.activeJob = e.detail.job || null;
        this.syncSettingsFromJob();

        // Auto-show for unprocessed
        if (this.activeJob?.status === 'unprocessed') {
          this.isVisible = true;
        }
      });

      // Listen for job created
      window.addEventListener('job-created', (e) => {
        this.activeJob = e.detail.job || null;
        this.syncSettingsFromJob();
        if (e.detail.isUnprocessed) {
          this.isVisible = true;
        }
      });

      // Listen for processing events
      window.addEventListener('job-processing-start', () => {
        this.isProcessing = true;
      });

      window.addEventListener('job-processing-complete', () => {
        this.isProcessing = false;
      });

      // Listen for settings toggle from jobNavigation
      window.addEventListener('job-settings-toggle', (e) => {
        this.isVisible = e.detail.open;
      });
    },

    // Load param configs for the current segmentation model
    loadSegmentationParamConfigs() {
      const modelId = this.settings.segmentationModelId;
      const model = this.segmentationModels.find(m => m.id === modelId);
      this.segmentationParamConfigs = model?.params || {};
    },

    // Get segmentation param keys for current model
    get segmentationParamKeys() {
      return Object.keys(this.segmentationParamConfigs);
    },

    // Sync local settings from active job
    syncSettingsFromJob() {
      if (!this.activeJob?.settings) return;

      const s = this.activeJob.settings;

      // Models
      this.settings.embeddingModelId = s.embeddingModel?.id || 'wavlm-base-sv';
      this.settings.segmentationModelId = s.segmentationModel?.id || 'phrase-gap';

      // Segmentation params
      this.settings.segmentationParams = { ...(s.segmentationParams || {}) };
      this.loadSegmentationParamConfigs();

      // Clustering
      this.settings.similarityThreshold = s.clustering?.similarityThreshold ?? 0.75;
      this.settings.confidenceMargin = s.clustering?.confidenceMargin ?? 0.15;
      this.settings.numSpeakers = s.clustering?.numSpeakers ?? 2;

      // Boosting
      this.settings.boostFactor = s.boosting?.boostFactor ?? 1.10;
      this.settings.boostEligibilityRank = s.boosting?.boostEligibilityRank ?? 2;
      this.settings.ambiguityMarginThreshold = s.boosting?.ambiguityMarginThreshold ?? 0.18;
      this.settings.skipBoostIfConfident = s.boosting?.skipBoostIfConfident ?? 0.82;
      this.settings.minSimilarityForBoosting = s.boosting?.minSimilarityForBoosting ?? 0.65;
      this.settings.minSimilarityAfterBoost = s.boosting?.minSimilarityAfterBoost ?? 0.75;

      // Save boosting settings for dirty detection (for processed jobs)
      this.savedBoostingSettings = {
        boostFactor: this.settings.boostFactor,
        boostEligibilityRank: this.settings.boostEligibilityRank,
        ambiguityMarginThreshold: this.settings.ambiguityMarginThreshold,
        skipBoostIfConfident: this.settings.skipBoostIfConfident,
        minSimilarityForBoosting: this.settings.minSimilarityForBoosting,
        minSimilarityAfterBoost: this.settings.minSimilarityAfterBoost,
      };
    },

    // Live mode helpers
    get isLiveMode() {
      return Alpine.store('liveMode').isLiveMode;
    },

    get isRecordingActive() {
      return Alpine.store('liveMode').isRecording;
    },

    // Embedding model can only be changed when NOT recording
    get isEmbeddingModelDisabled() {
      return this.isRecordingActive || this.isReadOnly || this.isLocked;
    },

    // Check if job is editable (live jobs and unprocessed jobs are editable)
    get isEditable() {
      const status = this.activeJob?.status;
      return (status === 'live' || status === 'unprocessed') && !this.isProcessing;
    },

    get isReadOnly() {
      return this.activeJob?.status === 'processed';
    },

    get isLocked() {
      return this.activeJob?.status === 'processing' || this.isProcessing;
    },

    // Boosting is editable for all jobs except when locked (processing)
    get isBoostingEditable() {
      return !this.isLocked;
    },

    // Check if boosting settings have changed from saved values
    get boostingDirty() {
      if (!this.savedBoostingSettings) return false;
      const boostingKeys = [
        'boostFactor', 'boostEligibilityRank', 'ambiguityMarginThreshold',
        'skipBoostIfConfident', 'minSimilarityForBoosting', 'minSimilarityAfterBoost',
      ];
      for (const key of boostingKeys) {
        if (this.settings[key] !== this.savedBoostingSettings[key]) {
          return true;
        }
      }
      return false;
    },

    // Handle segmentation model change
    onSegmentationModelChange(modelId) {
      this.settings.segmentationModelId = modelId;
      this.loadSegmentationParamConfigs();

      // Reset segmentation params to defaults for new model
      const newParams = {};
      for (const [key, config] of Object.entries(this.segmentationParamConfigs)) {
        newParams[key] = config.default;
      }
      this.settings.segmentationParams = newParams;

      // Update job settings
      if (this.activeJob?.settings) {
        this.activeJob.settings.segmentationParams = { ...newParams };
      }

      this.updateSetting('segmentationModelId', modelId);
    },

    // Update segmentation param
    updateSegmentationParam(key, value) {
      if (!this.isEditable || !this.activeJob) return;

      this.settings.segmentationParams[key] = value;

      // For live jobs, dispatch to app.js for immediate application
      if (this.isLiveMode) {
        window.dispatchEvent(new CustomEvent('live-job-setting-change', {
          detail: { key: 'segmentationParams', value: { [key]: value } },
        }));
        return;
      }

      // For saved jobs, update job settings in memory
      if (this.activeJob?.settings) {
        if (!this.activeJob.settings.segmentationParams) {
          this.activeJob.settings.segmentationParams = {};
        }
        this.activeJob.settings.segmentationParams[key] = value;
      }
    },

    // Update job settings (for live jobs and unprocessed jobs)
    updateSetting(key, value) {
      if (!this.isEditable || !this.activeJob) return;

      this.settings[key] = value;

      // For live jobs, dispatch to app.js for immediate application
      if (this.isLiveMode) {
        window.dispatchEvent(new CustomEvent('live-job-setting-change', {
          detail: { key, value },
        }));
        return;
      }

      // For saved jobs (unprocessed), update settings in memory and persist
      if (this.activeJob.settings) {
        // Embedding model change
        if (key === 'embeddingModelId') {
          const model = this.embeddingModels.find(m => m.id === value);
          if (model) {
            this.activeJob.settings.embeddingModel = { id: model.id, name: model.name };
          }
        }
        // Segmentation model change
        else if (key === 'segmentationModelId') {
          const model = this.segmentationModels.find(m => m.id === value);
          if (model) {
            this.activeJob.settings.segmentationModel = { id: model.id, name: model.name };
          }
        }
        // Clustering settings
        else if (['similarityThreshold', 'confidenceMargin', 'numSpeakers'].includes(key)) {
          if (!this.activeJob.settings.clustering) this.activeJob.settings.clustering = {};
          this.activeJob.settings.clustering[key] = value;

          // Dispatch event for numSpeakers so app.js can update live state
          if (key === 'numSpeakers') {
            window.dispatchEvent(new CustomEvent('num-speakers-change', { detail: { value } }));
          }
        }
        // Boosting settings
        else if ([
          'boostFactor',
          'boostEligibilityRank',
          'ambiguityMarginThreshold',
          'skipBoostIfConfident',
          'minSimilarityForBoosting',
          'minSimilarityAfterBoost',
        ].includes(key)) {
          if (!this.activeJob.settings.boosting) this.activeJob.settings.boosting = {};
          this.activeJob.settings.boosting[key] = value;
        }

        // Persist settings to storage (deep clone to avoid IndexedDB serialization issues)
        window.dispatchEvent(new CustomEvent('job-update-settings', {
          detail: { jobId: this.activeJob.id, settings: JSON.parse(JSON.stringify(this.activeJob.settings)) },
        }));
      }
    },

    // Process the job
    processJob(mode = 'quick') {
      if (!this.activeJob) return;
      window.dispatchEvent(new CustomEvent('job-process', {
        detail: { jobId: this.activeJob.id, mode },
      }));
    },

    // Update boosting setting (works for both editable and processed jobs)
    updateBoostingSetting(key, value) {
      if (this.isLocked || !this.activeJob) return;

      this.settings[key] = value;

      // For live jobs, dispatch to app.js for immediate application
      if (this.isLiveMode) {
        window.dispatchEvent(new CustomEvent('live-job-setting-change', {
          detail: { key, value },
        }));
        return;
      }

      // Update job settings in memory
      if (this.activeJob?.settings) {
        if (!this.activeJob.settings.boosting) this.activeJob.settings.boosting = {};
        this.activeJob.settings.boosting[key] = value;
      }

      // For unprocessed jobs, persist immediately
      if (!this.isReadOnly && this.activeJob?.settings) {
        window.dispatchEvent(new CustomEvent('job-update-settings', {
          detail: { jobId: this.activeJob.id, settings: JSON.parse(JSON.stringify(this.activeJob.settings)) },
        }));
      }
      // For processed jobs, dirty state will show re-apply button
    },

    // Re-apply boosting settings to processed job
    reapplyBoosting() {
      if (!this.activeJob || !this.isReadOnly || this.isReapplying) return;

      this.isReapplying = true;

      // Dispatch event with new boosting settings
      window.dispatchEvent(new CustomEvent('reapply-boosting', {
        detail: {
          jobId: this.activeJob.id,
          boostingSettings: {
            boostFactor: this.settings.boostFactor,
            boostEligibilityRank: this.settings.boostEligibilityRank,
            ambiguityMarginThreshold: this.settings.ambiguityMarginThreshold,
            skipBoostIfConfident: this.settings.skipBoostIfConfident,
            minSimilarityForBoosting: this.settings.minSimilarityForBoosting,
            minSimilarityAfterBoost: this.settings.minSimilarityAfterBoost,
          },
        },
      }));

      // Listen for completion
      const handleComplete = (e) => {
        if (e.detail.jobId === this.activeJob?.id) {
          this.isReapplying = false;
          // Update saved boosting settings to reflect new state
          this.savedBoostingSettings = { ...this.settings };
          window.removeEventListener('reapply-boosting-complete', handleComplete);
        }
      };
      window.addEventListener('reapply-boosting-complete', handleComplete);
    },

    // Get display name for embedding model
    getEmbeddingModelName(id) {
      const model = this.embeddingModels.find(m => m.id === id);
      return model?.name || id || 'Unknown';
    },

    // Get display name for segmentation model
    getSegmentationModelName(id) {
      const model = this.segmentationModels.find(m => m.id === id);
      return model?.name || id || 'Unknown';
    },

    // Segmentation param helpers
    getSegParamLabel(key) {
      return this.segmentationParamConfigs[key]?.label || key;
    },

    getSegParamDescription(key) {
      return this.segmentationParamConfigs[key]?.description || '';
    },

    getSegParamMin(key) {
      return this.segmentationParamConfigs[key]?.min ?? 0;
    },

    getSegParamMax(key) {
      return this.segmentationParamConfigs[key]?.max ?? 1;
    },

    getSegParamStep(key) {
      return this.segmentationParamConfigs[key]?.step ?? 0.1;
    },

    formatSegParamValue(key, value) {
      const config = this.segmentationParamConfigs[key];
      const unit = config?.unit || '';
      const formatted = parseFloat(value).toFixed(unit === 's' ? 2 : 2);
      return unit ? `${formatted}${unit}` : formatted;
    },

    // Format values for display
    formatThreshold(value) {
      return parseFloat(value).toFixed(2);
    },
  }));
});
