/**
 * Main Application Controller
 * Coordinates audio capture, worker inference, and UI updates
 */

// Audio layer (browser audio APIs)
import { AudioCapture, VADProcessor, AudioPlayback } from './audio/index.js';

// UI components
import { SpeakerVisualizer, ParticipantsPanel, DebugPanel, ResizeDividers } from './ui/index.js';

// Debug logging
import { DebugLogger } from './utils/debugLogger.js';

// Core inference
import { ConversationInference } from './core/inference/index.js';

// Enrollment manager (still in utils/ for now)
import { EnrollmentManager } from './utils/enrollmentManager.js';

// Storage layer
import { PreferencesStore, RecordingStore, ModelSelectionStore, SegmentationModelStore, enrollmentStore } from './storage/index.js';

// Model configuration
import { getEmbeddingModelConfig, getAvailableEmbeddingModels, DEFAULT_EMBEDDING_MODEL } from './config/models.js';
import { getSegmentationModelConfig } from './config/segmentation.js';

// Core modules (pure logic, no browser dependencies)
import { OverlapMerger, TranscriptMerger } from './core/transcription/index.js';
import { AudioValidator } from './core/validation/index.js';
import { cosineSimilarity, l2Normalize, computeDiscriminabilityMetrics } from './core/embedding/index.js';
import {
  serializeChunks,
  deserializeChunks,
  serializeTranscriptionData,
  calculateStorageSize,
  generateRecordingName,
  generateRecordingId,
  generateReprocessedName,
  formatDuration,
  formatFileSize,
  encodeWav,
  combineChunks,
  downloadBlob,
} from './core/recording/index.js';

// Configuration
import { REASON_BADGES, ATTRIBUTION_UI_DEFAULTS } from './config/defaults.js';
import {
  buildJobSettings,
  createJob,
  createLiveJob,
  JOB_STATUS,
  ENROLLMENT_SOURCE,
} from './config/jobDefaults.js';

export class App {
  constructor() {
    // State
    this.isModelLoaded = false;
    this.isRecording = false;
    this.isEnrolling = false;
    this.isEnrollmentRecording = false;
    this.device = 'wasm';
    this.numSpeakers = 2;
    this.pendingChunks = new Map();
    this.pendingEnrollmentSampleId = null;
    this.pendingExpectedSentence = null;
    this.pendingEnrollmentAudio = null; // Combined audio for current enrollment recording
    this.pendingTranscriptionResult = null;
    this.pendingEmbeddingResult = null;

    // Enrollment modal state
    this.enrollmentVAD = null; // VADProcessor instance for enrollment
    this.enrollmentAudioChunks = []; // Accumulated VAD speech chunks during recording
    this.enrollmentRecordingTimer = null; // Timer interval for recording duration display
    this.enrollmentStartTime = null; // When current recording started
    this.modalFocusTrap = null; // For accessibility focus management

    // VAD + overlap-based chunk management
    this.vadProcessor = null; // VAD processor for speech detection
    this.overlapMerger = new OverlapMerger(); // For comparing overlapping transcriptions
    this.lastChunkResult = null; // Previous chunk's result for overlap comparison
    this.globalTimeOffset = 0; // Tracks global time in the recording
    this.chunkQueue = []; // Queue of pending audio chunks
    this.isProcessingChunk = false; // Flag to ensure sequential processing

    // Debug stats
    this.completedChunks = 0;
    this.lastDebugTiming = null;
    this.lastPhraseDebug = null;
    this.bufferFillPercent = 0;
    this.rawChunksData = []; // Stored raw chunk data for export

    // Feature 7: Segment comparison mode
    this.comparisonMode = false;
    this.selectedSegments = []; // Indices of selected segments for comparison

    // Recording management
    this.recordingStore = null; // RecordingStore instance (initialized in init)
    this.sessionAudioChunks = []; // Cloned audio chunks for saving
    this.sessionTranscriptionData = []; // Raw Whisper output per chunk for saving
    this.isViewingRecording = false; // True when viewing a saved recording
    this.viewedRecordingId = null; // ID of currently viewed recording
    this.viewedJobId = null; // ID of currently viewed job within the recording
    this.audioPlayback = null; // AudioPlayback instance for replay
    this.liveJob = null; // Virtual job for live recording session (settings, state)

    // Components
    this.worker = null;
    this.enrollmentAudioCapture = null; // Still use AudioCapture for enrollment
    this.transcriptMerger = new TranscriptMerger(this.numSpeakers);
    this.enrollmentManager = new EnrollmentManager();
    this.speakerVisualizer = null;
    this.modalSpeakerVisualizer = null; // Visualizer for speakers modal
    this.conversationInference = new ConversationInference();
    this.participantsPanel = null;
    this.debugLogger = new DebugLogger();
    this.debugPanel = null;
    this.progressItems = new Map();

    // DOM elements - Main controls
    this.loadModelsBtn = document.getElementById('load-models-btn');
    this.recordBtn = document.getElementById('record-btn');
    this.uploadBtn = document.getElementById('upload-btn');
    this.uploadFileInput = document.getElementById('upload-file-input');
    this.clearBtn = document.getElementById('clear-btn');
    this.exportAllJobsBtn = document.getElementById('export-all-jobs-btn');
    this.exportRawBtn = document.getElementById('export-raw-btn');
    this.micSelect = document.getElementById('mic-select');
    this.loadingMessage = document.getElementById('loading-message');
    this.progressContainer = document.getElementById('progress-container');
    this.deviceInfo = document.getElementById('device-info');
    this.recordingStatus = document.getElementById('recording-status');
    this.transcriptContainer = document.getElementById('transcript-container');
    this.rawChunksContainer = document.getElementById('raw-chunks-container');
    this.audioVisualizer = document.getElementById('audio-visualizer');

    // DOM elements - Enrollment (sidebar UI managed by Alpine, we just need canvas)
    this.speakerCanvas = document.getElementById('speaker-canvas');

    // DOM elements - Enrollment Modal
    this.enrollmentModal = document.getElementById('enrollment-modal');
    this.modalSpeakerName = document.getElementById('modal-speaker-name');
    this.modalPassageText = document.getElementById('modal-passage-text');
    this.modalVolumeFill = document.getElementById('modal-volume-fill');
    this.modalVadIndicator = document.getElementById('modal-vad-indicator');
    this.modalVadText = document.getElementById('modal-vad-text');
    this.modalRecordingTimer = document.getElementById('modal-recording-timer');
    this.modalProgressDots = document.getElementById('modal-progress-dots');
    this.modalStatus = document.getElementById('modal-status');
    this.modalRecordBtn = document.getElementById('modal-record-btn');
    this.modalFinishBtn = document.getElementById('modal-finish-btn');
    this.modalCancelBtn = document.getElementById('modal-cancel-btn');
    this.modalUploadBtn = document.getElementById('modal-upload-btn');
    this.modalFileInput = document.getElementById('modal-file-input');

    // Status bar and phrase stats are managed by Alpine - we dispatch events to update them

    // Resize dividers for workspace and sidebar
    this.resizeDividers = null;

    this.init();
  }

  /**
   * Initialize the application
   */
  async init() {
    // Create Web Worker
    this.worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    // Setup worker message handling
    this.worker.addEventListener('message', (e) => this.handleWorkerMessage(e));

    // Setup UI event listeners
    this.setupEventListeners();

    // Notify tuning panel of current boosting config
    window.dispatchEvent(new CustomEvent('boosting-config-loaded', {
      detail: this.conversationInference.getConfig(),
    }));

    // Check for WebGPU support
    await this.detectWebGPU();

    // Initialize enrollment store (handles migration from localStorage if needed)
    await EnrollmentManager.init();

    // Initialize resizable dividers first (restores saved sidebar width)
    this.initResizeDividers();

    // Load saved enrollments
    await this.loadSavedEnrollments();

    // Initialize visualization (canvas will be sized correctly now)
    this.initVisualization();

    // Initialize debug logging
    await this.debugLogger.init();
    this.debugPanel = new DebugPanel({ logger: this.debugLogger });
    this.debugPanel.init();

    // Initialize recording store
    this.recordingStore = new RecordingStore();
    await this.recordingStore.init();
    await this.loadRecordingsList();

    // Populate microphone dropdown
    this.populateMicrophoneList();

    // Expose speakerClusterer for debug toggling via console
    // Usage: window.speakerClusterer.debugLogging = true
    window.speakerClusterer = this.transcriptMerger.speakerClusterer;

    // Update status bar
    this.updateStatusBar('ready');

    // Auto-load models
    this.loadModels();
  }

  /**
   * Populate the microphone dropdown with available audio input devices
   */
  async populateMicrophoneList() {
    try {
      const devices = await AudioCapture.getAudioInputDevices();

      // Clear existing options except default
      this.micSelect.innerHTML = '<option value="">Default</option>';

      // Add each device
      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label;
        this.micSelect.appendChild(option);
      }

      // Restore saved selection if any
      const savedDeviceId = PreferencesStore.getSelectedMicDevice();
      if (savedDeviceId) {
        this.micSelect.value = savedDeviceId;
      }

      // Save selection on change
      this.micSelect.addEventListener('change', () => {
        PreferencesStore.setSelectedMicDevice(this.micSelect.value);
      });
    } catch (error) {
      console.error('Failed to populate microphone list:', error);
    }
  }

  /**
   * Detect WebGPU availability
   */
  async detectWebGPU() {
    if ('gpu' in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.device = 'webgpu';
          this.deviceInfo.innerHTML = `<strong>Acceleration:</strong> WebGPU (GPU-accelerated)`;
          return;
        }
      } catch (e) {
        console.log('WebGPU not available:', e);
      }
    }
    this.device = 'wasm';
    this.deviceInfo.innerHTML = `<strong>Acceleration:</strong> WebAssembly (CPU)`;
  }

  /**
   * Setup UI event listeners
   */
  setupEventListeners() {
    // Main controls - Alpine dispatches events, we listen here
    window.addEventListener('toggle-recording', () => this.toggleRecording());
    window.addEventListener('clear-transcript', () => this.clearTranscript());
    window.addEventListener('upload-audio', () => this.uploadFileInput.click());
    this.uploadFileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.loadModelsBtn.addEventListener('click', () => this.loadModels());
    this.exportAllJobsBtn.addEventListener('click', () => this.exportAllJobs());
    this.exportRawBtn.addEventListener('click', () => this.exportRawChunks());

    // Job export events (from jobNavigation component)
    window.addEventListener('job-copy-json', (e) => this.copyJobJson(e.detail.jobId));
    window.addEventListener('job-export', (e) => this.exportJob(e.detail.jobId));

    // Settings changes from Alpine sidebar
    window.addEventListener('num-speakers-change', (e) => this.handleNumSpeakersChange(e.detail.value));

    // Enrollment controls - Alpine sidebar dispatches events, we listen here
    window.addEventListener('enrollment-start', (e) => {
      this.startEnrollmentWithName(e.detail.name);
    });
    window.addEventListener('enrollment-remove', (e) => {
      this.removeEnrollment(e.detail.id);
    });
    window.addEventListener('enrollment-clear-all', () => {
      this.clearAllEnrollments();
    });
    window.addEventListener('speakers-modal-opened', async () => {
      // Send available visualization models to Alpine
      const models = await this.getVisualizationModels();
      window.dispatchEvent(new CustomEvent('visualization-models-updated', {
        detail: { models }
      }));
      // Render with default (first available model or null)
      const defaultModel = models.length > 0 ? models[0].id : null;
      await this.updateModalVisualization(defaultModel);

      // Compute and dispatch metrics for default model
      if (defaultModel) {
        const metrics = await this.computeMetricsForModel(defaultModel);
        window.dispatchEvent(new CustomEvent('visualization-metrics-updated', { detail: { metrics, modelId: defaultModel } }));
      }
    });
    window.addEventListener('visualization-model-change', async (e) => {
      const modelId = e.detail.modelId;
      let metrics = null;

      // Check if we need to compute embeddings for this model
      const enrollments = await enrollmentStore.getEnrollmentsForVisualization(modelId);
      const totalEnrollments = await enrollmentStore.count();

      if (enrollments.length < totalEnrollments && totalEnrollments > 0) {
        // Need to compute embeddings - show loading state
        window.dispatchEvent(new CustomEvent('visualization-loading', { detail: { loading: true, modelId } }));

        try {
          metrics = await this.computeEmbeddingsForModel(modelId);
          // Update models list to reflect new status
          const models = await this.getVisualizationModels();
          window.dispatchEvent(new CustomEvent('visualization-models-updated', { detail: { models } }));
        } catch (err) {
          console.error('[App] Failed to compute embeddings:', err);
        } finally {
          window.dispatchEvent(new CustomEvent('visualization-loading', { detail: { loading: false } }));
        }
      } else {
        // Model already has embeddings, compute metrics from stored data
        metrics = await this.computeMetricsForModel(modelId);
      }

      // Dispatch metrics update
      window.dispatchEvent(new CustomEvent('visualization-metrics-updated', { detail: { metrics, modelId } }));

      await this.updateModalVisualization(modelId);
    });

    // Handle recalculate embeddings request
    window.addEventListener('visualization-recalculate', async (e) => {
      const modelId = e.detail.modelId;
      window.dispatchEvent(new CustomEvent('visualization-loading', { detail: { loading: true, modelId } }));

      try {
        const metrics = await this.recalculateEmbeddingsForModel(modelId);
        const models = await this.getVisualizationModels();
        window.dispatchEvent(new CustomEvent('visualization-models-updated', { detail: { models } }));
        window.dispatchEvent(new CustomEvent('visualization-metrics-updated', { detail: { metrics, modelId } }));
      } catch (err) {
        console.error('[App] Failed to recalculate embeddings:', err);
      } finally {
        window.dispatchEvent(new CustomEvent('visualization-loading', { detail: { loading: false } }));
      }

      await this.updateModalVisualization(modelId);
    });

    // Enrollment modal controls
    this.modalRecordBtn.addEventListener('click', () => this.toggleModalRecording());
    this.modalFinishBtn.addEventListener('click', () => this.finishModalEnrollment());
    this.modalCancelBtn.addEventListener('click', () => this.cancelModalEnrollment());
    this.modalUploadBtn.addEventListener('click', () => this.handleUploadClick());
    this.modalFileInput.addEventListener('change', (e) => this.handleFileSelected(e));
    this.enrollmentModal.addEventListener('keydown', (e) => this.handleModalKeydown(e));

    // Close modal on backdrop click (only when not recording)
    this.enrollmentModal.addEventListener('click', (e) => {
      if (e.target === this.enrollmentModal && !this.isEnrollmentRecording) {
        this.closeEnrollmentModal();
      }
    });

    // Recording management events
    window.addEventListener('recording-load', (e) => this.loadRecording(e.detail.id));
    window.addEventListener('recording-delete', (e) => this.deleteRecording(e.detail.id));
    window.addEventListener('recording-rename', (e) => this.renameRecording(e.detail.id, e.detail.name));
    window.addEventListener('recording-return-to-live', () => this.returnToLive());
    window.addEventListener('recording-download', (e) => this.downloadRecordingAsWav(e.detail.id));

    // Job management events
    window.addEventListener('job-switch', (e) => this.switchJob(e.detail.jobId));
    window.addEventListener('job-create-new', () => this.createNewJob());
    window.addEventListener('job-clone', (e) => this.cloneJob(e.detail.sourceJobId));
    window.addEventListener('job-delete', (e) => this.deleteJob(e.detail.jobId));
    window.addEventListener('job-update-name', (e) => this.updateJobName(e.detail.jobId, e.detail.name, e.detail.customized !== false));
    window.addEventListener('job-update-notes', (e) => this.updateJobNotes(e.detail.jobId, e.detail.notes));
    window.addEventListener('job-update-settings', (e) => this.updateJobSettings(e.detail.jobId, e.detail.settings));
    window.addEventListener('job-process', (e) => this.processJob(e.detail.jobId, e.detail.mode || 'quick'));

    // Live job settings changes (applies to live processing in real-time)
    window.addEventListener('live-job-setting-change', (e) => {
      this._handleLiveJobSettingChange(e.detail.key, e.detail.value);
    });

    // Playback control events
    window.addEventListener('playback-toggle', () => this.togglePlayback());
    window.addEventListener('playback-seek', (e) => this.seekPlayback(e.detail.time));

    // Enrollment source toggle
    window.addEventListener('enrollment-source-change', (e) => this.handleEnrollmentSourceChange(e.detail.source));

    // Boosting tuning events - update config and re-process segments
    window.addEventListener('boosting-config-update', (e) => {
      this.conversationInference.updateConfig(e.detail);
      this.reprocessBoostingForCurrentSegments();
    });
    window.addEventListener('boosting-config-reset', () => {
      this.conversationInference.resetConfig();
      this.reprocessBoostingForCurrentSegments();
    });

    // Segmentation tuning events - forward to worker
    window.addEventListener('segmentation-param-update', (e) => {
      const { key, value } = e.detail;
      this.updateSegmentationParams({ [key]: value });
    });
    window.addEventListener('segmentation-params-reset', (e) => {
      const { params } = e.detail;
      this.updateSegmentationParams(params);
    });

    // Debug logging events (from status bar popover)
    window.addEventListener('debug-toggle', (e) => {
      this.debugLogger.setEnabled(e.detail.enabled);
      this.dispatchDebugStatusUpdate();
    });
    window.addEventListener('debug-verbose-toggle', (e) => {
      this.debugLogger.setVerbose(e.detail.verbose);
      this.dispatchDebugStatusUpdate();
    });
    window.addEventListener('debug-export', () => {
      this.debugLogger.exportCurrentSession();
    });
    window.addEventListener('debug-clear', async () => {
      const confirmed = confirm('Clear all debug logs? This cannot be undone.');
      if (confirmed) {
        await this.debugLogger.clearAllLogs();
        this.dispatchDebugStatusUpdate();
      }
    });
  }

  /**
   * Send updated segmentation params to the worker
   * @param {Record<string, number>} params - Params to update
   */
  updateSegmentationParams(params) {
    if (!this.worker) {
      console.warn('[App] Cannot update segmentation params: worker not ready');
      return;
    }
    this.worker.postMessage({
      type: 'set-segmentation-params',
      data: { params },
    });
  }

  /**
   * Handle number of speakers change (from settings sidebar)
   */
  handleNumSpeakersChange(value) {
    this.numSpeakers = value;
    this.transcriptMerger.setNumSpeakers(this.numSpeakers);

    // Update inference layer and recalculate if needed
    const changedSegments = this.conversationInference.setExpectedSpeakers(this.numSpeakers);
    if (changedSegments && changedSegments.length > 0) {
      this.updateParticipantsPanel();
    }
  }

  /**
   * Handle messages from worker
   */
  handleWorkerMessage(event) {
    const { type, status, message, data } = event.data;

    switch (type) {
      case 'status':
        this.handleStatusUpdate(status, message);
        break;

      case 'loading-stage':
        this.loadingMessage.textContent = event.data.stage;
        break;

      case 'progress':
        this.handleProgress(event.data);
        break;

      case 'result':
        this.handleTranscriptionResult(data);
        break;

      case 'embedding-result':
        this.handleEnrollmentEmbedding(data);
        break;

      case 'transcription-validation-result':
        this.handleTranscriptionValidation(data);
        break;

      case 'error':
        console.error('Worker error:', message);
        this.loadingMessage.textContent = message;
        this.loadingMessage.className = 'status-error';
        // Notify Alpine components of error status
        window.dispatchEvent(new CustomEvent('model-status-update', { detail: { status: 'error' } }));
        break;

      case 'debug-log':
        this.debugLogger.log(event.data.logType, event.data.data);
        break;

      case 'batch-embedding-progress':
        window.dispatchEvent(new CustomEvent('job-processing-progress', {
          detail: { current: event.data.current, total: event.data.total, mode: 'quick' },
        }));
        break;

      case 'batch-embedding-result':
        // Handled via promise resolver set in batchExtractEmbeddings
        if (this._batchEmbeddingResolver) {
          this._batchEmbeddingResolver(event.data.results);
          this._batchEmbeddingResolver = null;
        }
        break;
    }
  }

  /**
   * Handle status updates from worker
   */
  handleStatusUpdate(status, message) {
    this.loadingMessage.textContent = message;
    this.loadingMessage.className = `status-${status}`;

    if (status === 'ready') {
      this.isModelLoaded = true;
      this.loadModelsBtn.textContent = 'Models Loaded';
      this.loadModelsBtn.disabled = true;

      // Notify Alpine components that model is loaded (enables enrollment buttons)
      window.dispatchEvent(new CustomEvent('model-loaded'));

      // Create live job with current settings (now that models are loaded)
      this.liveJob = this._createFreshLiveJob();
      this._dispatchLiveJobState();

      // Update status bar
      this.updateStatusBar('ready');

      // Auto-collapse model status panel (via Alpine event)
      window.dispatchEvent(
        new CustomEvent('panel-collapse', { detail: { panel: 'model-status' } })
      );

      // Recompute enrollments for current model if needed
      // (enrollments may have been created with a different model)
      this.recomputeEnrollmentsForCurrentModel();
    } else if (status === 'loading') {
      this.updateStatusBar('loading');
      // Expand model status panel during load (via Alpine event)
      window.dispatchEvent(
        new CustomEvent('panel-expand', { detail: { panel: 'model-status' } })
      );
    } else if (status === 'error') {
      this.loadModelsBtn.textContent = 'Retry Loading';
      this.loadModelsBtn.disabled = false;
      this.loadModelsBtn.classList.remove('hidden');
      this.updateStatusBar('ready');

      // Notify Alpine components of error status
      window.dispatchEvent(new CustomEvent('model-status-update', { detail: { status: 'error' } }));
    }
  }

  /**
   * Handle progress updates for model downloads
   */
  handleProgress(progress) {
    const { status, file, progress: percent, loaded, total } = progress;

    if (!file) return;

    const shortName = file.split('/').pop();

    // Ensure progress item exists for any status (handles out-of-order events)
    if (!this.progressItems.has(file)) {
      this.addProgressItem(file, shortName);
    }

    if (status === 'progress') {
      // Update progress
      this.updateProgressItem(file, percent, loaded, total);
    } else if (status === 'done' || status === 'ready') {
      // File completed (Transformers.js sends 'ready' for cached files)
      this.completeProgressItem(file);
    }
  }

  /**
   * Add a progress bar for a downloading file
   */
  addProgressItem(file, name) {
    const itemEl = document.createElement('div');
    itemEl.className = 'progress-item';
    itemEl.innerHTML = `
      <div class="progress-label">
        <span>${name}</span>
        <span class="progress-percent">0%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    `;

    this.progressContainer.appendChild(itemEl);
    this.progressItems.set(file, itemEl);
  }

  /**
   * Update progress bar
   */
  updateProgressItem(file, percent, loaded, total) {
    const itemEl = this.progressItems.get(file);
    if (!itemEl) return;

    const fill = itemEl.querySelector('.progress-fill');
    const percentLabel = itemEl.querySelector('.progress-percent');

    const percentValue = percent ?? (loaded && total ? (loaded / total) * 100 : 0);
    fill.style.width = `${percentValue}%`;
    percentLabel.textContent = `${Math.round(percentValue)}%`;
  }

  /**
   * Mark progress bar as complete
   */
  completeProgressItem(file) {
    const itemEl = this.progressItems.get(file);
    if (!itemEl) return;

    const fill = itemEl.querySelector('.progress-fill');
    const percentLabel = itemEl.querySelector('.progress-percent');

    fill.style.width = '100%';
    fill.style.background = '#10b981';
    percentLabel.textContent = 'Cached';
  }

  // ==========================================
  // Live Job Management
  // ==========================================

  /**
   * Create a fresh live job from current settings.
   * Called at startup and when returning to live mode.
   */
  _createFreshLiveJob() {
    const embeddingModelId = ModelSelectionStore.getEmbeddingModel();
    const segmentationModelId = SegmentationModelStore.getSegmentationModel();
    const segmentationParams = SegmentationModelStore.getParams(segmentationModelId);

    return createLiveJob({
      embeddingModelId,
      segmentationModelId,
      segmentationParams,
      clustering: {
        numSpeakers: this.numSpeakers,
        similarityThreshold: this.transcriptMerger.speakerClusterer.similarityThreshold,
        confidenceMargin: this.transcriptMerger.speakerClusterer.confidenceMargin,
      },
      boosting: {
        boostFactor: this.conversationInference.config.boostFactor,
        boostEligibilityRank: this.conversationInference.config.boostEligibilityRank,
        ambiguityMarginThreshold: this.conversationInference.config.ambiguityMarginThreshold,
        skipBoostIfConfident: this.conversationInference.config.skipBoostIfConfident,
        minSimilarityForBoosting: this.conversationInference.config.minSimilarityForBoosting,
        minSimilarityAfterBoost: this.conversationInference.config.minSimilarityAfterBoost,
      },
    });
  }

  /**
   * Dispatch live job state to Alpine components.
   * Called when live job is created, updated, or mode changes.
   */
  _dispatchLiveJobState() {
    window.dispatchEvent(new CustomEvent('live-job-updated', {
      detail: {
        job: this.liveJob,
        isLiveMode: !this.isViewingRecording,
        isRecording: this.isRecording,
      },
    }));
  }

  /**
   * Handle live job setting changes from the settings panel.
   * Updates both the liveJob object and applies to live processing.
   * @param {string} key - Setting key (e.g., 'similarityThreshold', 'boostFactor')
   * @param {*} value - New value for the setting
   */
  _handleLiveJobSettingChange(key, value) {
    if (!this.liveJob) return;

    // Clustering settings - apply to transcriptMerger's clusterer
    if (key === 'similarityThreshold') {
      this.liveJob.settings.clustering.similarityThreshold = value;
      this.transcriptMerger.speakerClusterer.similarityThreshold = value;
    } else if (key === 'confidenceMargin') {
      this.liveJob.settings.clustering.confidenceMargin = value;
      this.transcriptMerger.speakerClusterer.confidenceMargin = value;
    } else if (key === 'numSpeakers') {
      this.liveJob.settings.clustering.numSpeakers = value;
      this.handleNumSpeakersChange(value);
    }
    // Boosting settings - apply to conversationInference
    else if ([
      'boostFactor',
      'boostEligibilityRank',
      'ambiguityMarginThreshold',
      'skipBoostIfConfident',
      'minSimilarityForBoosting',
      'minSimilarityAfterBoost',
    ].includes(key)) {
      this.liveJob.settings.boosting[key] = value;
      this.conversationInference.updateConfig({ [key]: value });
      // Re-process boosting for existing segments
      this.reprocessBoostingForCurrentSegments();
    }
    // Segmentation params - update liveJob and forward to worker
    else if (key === 'segmentationParams') {
      Object.assign(this.liveJob.settings.segmentationParams, value);
      this.updateSegmentationParams(value);
    }
    // Model changes - update liveJob (actual model reload handled separately)
    else if (key === 'embeddingModelId') {
      const config = getEmbeddingModelConfig(value);
      this.liveJob.settings.embeddingModel = {
        id: config.id,
        name: config.name,
        dimensions: config.dimensions,
      };
      ModelSelectionStore.setEmbeddingModel(value);
    } else if (key === 'segmentationModelId') {
      const config = getSegmentationModelConfig(value);
      this.liveJob.settings.segmentationModel = {
        id: config.id,
        name: config.name,
      };
      SegmentationModelStore.setSegmentationModel(value);
    }
  }

  /**
   * Load models via worker
   */
  loadModels() {
    this.loadModelsBtn.disabled = true;
    this.loadModelsBtn.textContent = 'Loading...';
    this.progressContainer.innerHTML = '';
    this.progressItems.clear();

    // Get selected embedding model configuration
    const embeddingModelId = ModelSelectionStore.getEmbeddingModel();
    const embeddingModelConfig = getEmbeddingModelConfig(embeddingModelId);

    // Get selected segmentation model configuration and saved params
    const segmentationModelId = SegmentationModelStore.getSegmentationModel();
    const segmentationModelConfig = getSegmentationModelConfig(segmentationModelId);
    const segmentationParams = SegmentationModelStore.getParams(segmentationModelId);

    console.log(`[App] Loading models - embedding: ${embeddingModelConfig.name}, segmentation: ${segmentationModelConfig.name}`);

    // Notify Alpine that models are loading
    window.dispatchEvent(new CustomEvent('model-status-update', { detail: { status: 'loading' } }));

    this.worker.postMessage({
      type: 'load',
      data: {
        device: this.device,
        embeddingModel: embeddingModelConfig,
        segmentationModel: segmentationModelConfig,
        segmentationParams: segmentationParams,
      },
    });
  }

  /**
   * Toggle recording on/off
   */
  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  /**
   * Start recording
   */
  async startRecording() {
    // If viewing a saved recording, return to live mode first
    if (this.isViewingRecording) {
      this.returnToLive();
    }

    // Reset for new session
    this.transcriptMerger.reset();
    this.clearTranscriptDisplay();
    this.clearRawChunksDisplay();
    this.pendingChunks.clear();
    this.lastChunkResult = null;
    this.globalTimeOffset = 0;
    this.chunkQueue = [];
    this.isProcessingChunk = false;
    this.completedChunks = 0;
    this.lastDebugTiming = null;
    this.lastPhraseDebug = null;
    this.sessionAudioChunks = []; // Reset audio chunks for new recording
    this.sessionTranscriptionData = []; // Reset transcription data for new recording

    // Start debug logging session
    await this.debugLogger.startSession();

    // Reset UI
    this.updateChunkQueueViz();

    // Get selected microphone device ID
    const selectedDeviceId = this.micSelect.value || null;

    // Create VAD processor for speech-triggered chunking
    this.vadProcessor = new VADProcessor({
      minSpeechDuration: 1.0, // Min 1s of speech before emitting
      maxSpeechDuration: 15.0, // Max 15s - force emit at this point
      overlapDuration: 1.5, // 1.5s overlap between chunks
      deviceId: selectedDeviceId,
      onSpeechStart: () => this.handleSpeechStart(),
      onSpeechEnd: (chunk) => this.handleAudioChunk(chunk),
      onSpeechProgress: (progress) => this.handleSpeechProgress(progress),
      onError: (error) => this.handleError(error),
      onAudioLevel: (level) => this.updateAudioLevel(level),
    });

    const initSuccess = await this.vadProcessor.init();
    if (!initSuccess) {
      this.recordingStatus.textContent =
        'Failed to initialize VAD. Please check permissions and try again.';
      return;
    }

    try {
      await this.vadProcessor.start();
      this.isRecording = true;
      this.recordingStatus.textContent = 'Listening for speech...';
      this.updateStatusBar('recording');

      // Notify Alpine of recording state change
      window.dispatchEvent(
        new CustomEvent('recording-state', { detail: { recording: true } })
      );

      // Update live job state (isRecording changed)
      this._dispatchLiveJobState();
    } catch (error) {
      this.recordingStatus.textContent =
        'Failed to access microphone. Please check permissions and try again.';
      console.error('Failed to start VAD:', error);
    }
  }

  /**
   * Handle speech start from VAD
   */
  handleSpeechStart() {
    this.recordingStatus.textContent = 'Detecting speech...';
  }

  /**
   * Handle speech progress from VAD
   */
  handleSpeechProgress(progress) {
    const { duration, probability } = progress;
    this.recordingStatus.textContent = `Speaking... (${duration.toFixed(1)}s)`;
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    if (this.vadProcessor) {
      await this.vadProcessor.stop();
      await this.vadProcessor.destroy();
      this.vadProcessor = null;
    }

    // End debug logging session
    await this.debugLogger.endSession();

    this.isRecording = false;

    // Notify Alpine of recording state change
    window.dispatchEvent(
      new CustomEvent('recording-state', { detail: { recording: false } })
    );

    // Update live job state (isRecording changed)
    this._dispatchLiveJobState();

    if (this.pendingChunks.size > 0 || this.chunkQueue.length > 0) {
      this.recordingStatus.textContent = `Processing ${this.pendingChunks.size + this.chunkQueue.length} remaining chunk(s)...`;
      this.updateStatusBar('processing');
    } else {
      this.recordingStatus.textContent = 'Recording stopped.';
      this.updateStatusBar('ready');
    }
  }

  /**
   * Handle file upload for audio processing
   */
  async handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset file input so same file can be selected again
    event.target.value = '';

    if (!this.isModelLoaded) {
      this.recordingStatus.textContent = 'Please wait for models to load.';
      return;
    }

    if (this.isRecording) {
      this.recordingStatus.textContent = 'Stop recording before uploading a file.';
      return;
    }

    try {
      this.recordingStatus.textContent = `Loading ${file.name}...`;
      this.updateStatusBar('processing');

      // Disable buttons during processing
      this.uploadBtn.disabled = true;
      this.recordBtn.disabled = true;

      // Reset state for new processing
      this.transcriptMerger.reset();
      this.clearTranscriptDisplay();
      this.clearRawChunksDisplay();
      this.pendingChunks.clear();
      this.lastChunkResult = null;
      this.globalTimeOffset = 0;
      this.chunkQueue = [];
      this.isProcessingChunk = false;
      this.completedChunks = 0;
      this.rawChunksData = [];
      this.sessionTranscriptionData = [];

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Decode to AudioBuffer
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Resample to 16kHz mono
      const audio16k = await this.resampleTo16kMono(audioBuffer);

      this.recordingStatus.textContent = `Processing ${file.name} (${(audio16k.length / 16000).toFixed(1)}s)...`;

      // Process as fixed-time chunks (simpler than VAD for clean uploaded audio)
      await this.processUploadedAudioAsChunks(audio16k, file.name);

      // Clean up
      await audioContext.close();

    } catch (error) {
      console.error('File upload error:', error);
      this.recordingStatus.textContent = `Error: ${error.message}`;
      this.updateStatusBar('ready');
      this.uploadBtn.disabled = false;
      this.recordBtn.disabled = false;
    }
  }

  /**
   * Resample audio to 16kHz mono
   */
  async resampleTo16kMono(audioBuffer) {
    const targetSampleRate = 16000;

    // Create offline context for resampling
    const offlineContext = new OfflineAudioContext(
      1, // mono
      Math.ceil(audioBuffer.duration * targetSampleRate),
      targetSampleRate
    );

    // Create buffer source
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    // Render
    const renderedBuffer = await offlineContext.startRendering();
    return renderedBuffer.getChannelData(0);
  }

  /**
   * Process uploaded audio as fixed-time chunks
   * Uses 10s chunks with 1.5s overlap - phrase detector handles speech boundaries
   */
  async processUploadedAudioAsChunks(audio16k, filename) {
    const sampleRate = 16000;
    const chunkDuration = 10; // 10 seconds per chunk
    const overlapDuration = 1.5; // 1.5s overlap
    const chunkSamples = chunkDuration * sampleRate;
    const overlapSamples = overlapDuration * sampleRate;

    const chunks = [];

    // Split audio into chunks
    let position = 0;
    while (position < audio16k.length) {
      const endPosition = Math.min(position + chunkSamples, audio16k.length);
      const chunkAudio = audio16k.slice(position, endPosition);

      // Calculate overlap from previous chunk
      let audioWithOverlap = chunkAudio;
      let actualOverlapDuration = 0;

      if (position > 0 && position >= overlapSamples) {
        // Prepend overlap from before this chunk's start
        const overlapStart = position - overlapSamples;
        const overlap = audio16k.slice(overlapStart, position);
        audioWithOverlap = new Float32Array(overlap.length + chunkAudio.length);
        audioWithOverlap.set(overlap);
        audioWithOverlap.set(chunkAudio, overlap.length);
        actualOverlapDuration = overlap.length / sampleRate;
      }

      chunks.push({
        audio: audioWithOverlap,
        overlapDuration: actualOverlapDuration,
      });

      position = endPosition;
    }

    if (chunks.length === 0) {
      this.recordingStatus.textContent = 'Audio file is empty.';
      this.updateStatusBar('ready');
      this.uploadBtn.disabled = false;
      this.recordBtn.disabled = false;
      return;
    }

    this.recordingStatus.textContent = `Processing ${chunks.length} chunk(s) from ${filename}...`;

    // Queue all chunks for processing
    for (let i = 0; i < chunks.length; i++) {
      const chunk = {
        index: i,
        audio: chunks[i].audio,
        rawDuration: chunks[i].audio.length / sampleRate,
        overlapDuration: chunks[i].overlapDuration,
        isFinal: i === chunks.length - 1,
      };

      this.handleAudioChunk(chunk);
    }

    // Re-enable buttons (actual processing happens async via queue)
    this.uploadBtn.disabled = false;
    this.recordBtn.disabled = false;
  }

  /**
   * Handle audio chunk from capture
   */
  handleAudioChunk(chunk) {
    // Log VAD chunk emission
    this.debugLogger.logVadChunk({
      chunkIndex: chunk.index,
      duration: chunk.audio.length / 16000, // Assuming 16kHz sample rate
      wasForced: chunk.wasForced || false,
      overlapDuration: chunk.overlapDuration || 0,
      rawDuration: chunk.rawDuration,
      isFinal: chunk.isFinal,
    });

    // Clone audio for session recording (before queuing)
    if (this.isRecording && !this.isViewingRecording) {
      this.sessionAudioChunks.push({
        index: chunk.index,
        audio: new Float32Array(chunk.audio), // Clone the audio
        duration: chunk.audio.length / 16000,
        overlapDuration: chunk.overlapDuration || 0,
        isFinal: chunk.isFinal || false,
      });
    }

    // Queue the chunk for processing
    this.chunkQueue.push(chunk);

    // Update status
    const queueSize = this.chunkQueue.length;
    if (queueSize > 1) {
      this.recordingStatus.textContent = `Recording... (${queueSize} chunks queued)`;
    }

    // Update chunk queue visualization
    this.updateChunkQueueViz();

    // Process next chunk if not already processing
    this.processNextChunk();
  }

  /**
   * Process the next chunk in the queue
   */
  processNextChunk() {
    // Don't process if already processing or queue is empty
    if (this.isProcessingChunk || this.chunkQueue.length === 0) {
      return;
    }

    this.isProcessingChunk = true;
    const chunk = this.chunkQueue.shift();

    const durationStr = chunk.rawDuration ? `${chunk.rawDuration.toFixed(1)}s` : '';
    const processingText = chunk.isFinal
      ? `Processing final chunk...`
      : `Processing chunk ${chunk.index + 1} (${durationStr})...`;
    this.recordingStatus.textContent = processingText;

    // Update chunk queue visualization
    this.updateChunkQueueViz();

    // VADProcessor now handles overlap prepending
    // chunk.audio already includes overlap from previous segment
    // chunk.overlapDuration tells us how much overlap is at the start

    // Track pending chunk info
    this.pendingChunks.set(chunk.index, {
      globalStartTime: this.globalTimeOffset,
      overlapDuration: chunk.overlapDuration || 0,
      audio: chunk.audio,
      isFinal: chunk.isFinal,
    });

    // Show processing indicator
    this.showProcessingIndicator();

    // Send audio to worker for transcription
    this.worker.postMessage({
      type: 'transcribe',
      data: {
        audio: chunk.audio,
        language: 'en',
        chunkIndex: chunk.index,
        overlapDuration: chunk.overlapDuration || 0,
        isFinal: chunk.isFinal,
      },
    });
  }

  /**
   * Handle transcription result from worker
   */
  handleTranscriptionResult(data) {
    const {
      transcript,
      phrases,
      chunkIndex,
      processingTime,
      overlapDuration,
      debug,
      rawAsr,
      isFinal: isFinalFromWorker,
      isEffectivelyEmpty,
    } = data;

    // Get chunk info
    const chunkInfo = this.pendingChunks.get(chunkIndex);
    if (!chunkInfo) {
      console.warn('No chunk info for index', chunkIndex);
      // Continue processing queue even on error
      this.isProcessingChunk = false;
      this.processNextChunk();
      return;
    }

    const { globalStartTime, audio, isFinal } = chunkInfo;

    // Remove from pending
    this.pendingChunks.delete(chunkIndex);

    // Track completed chunks
    this.completedChunks++;

    // Store debug timing
    if (debug) {
      this.lastDebugTiming = debug;
      this.updateStatusBarMetrics(debug, processingTime);
    }

    // Hide processing indicator if no more pending and queue is empty
    if (this.pendingChunks.size === 0 && this.chunkQueue.length === 0) {
      this.hideProcessingIndicator();

      // Auto-save recording when all chunks are processed and recording has stopped
      if (!this.isRecording && this.sessionAudioChunks.length > 0 && !this.isViewingRecording) {
        this.saveCurrentSession();
      }
    }

    // Overlap-based merging: compare with previous chunk's words
    let wordsToUse = transcript?.chunks || [];
    let phrasesToUse = phrases || [];
    let mergeInfo = null;

    if (this.lastChunkResult && overlapDuration > 0 && wordsToUse.length > 0) {
      // Find merge point by comparing overlap regions
      mergeInfo = this.overlapMerger.findMergePoint(
        this.lastChunkResult.words,
        wordsToUse,
        overlapDuration
      );

      // Remove overlapping words from current transcript
      if (mergeInfo.mergeIndex > 0) {
        wordsToUse = wordsToUse.slice(mergeInfo.mergeIndex);

        // Also filter phrases to only include those after merge point
        const mergeTimestamp = mergeInfo.timestamp || overlapDuration;
        phrasesToUse = phrases.filter((p) => p.start >= mergeTimestamp);

        // Adjust timestamps for the words we keep (subtract overlap)
        wordsToUse = this.overlapMerger.adjustTimestamps(wordsToUse, overlapDuration);
      }
    }

    // Log overlap merge decision
    this.debugLogger.logOverlapMerge({
      chunkIndex,
      hadPreviousChunk: !!this.lastChunkResult,
      overlapDuration: overlapDuration || 0,
      mergeMethod: mergeInfo?.method || 'none',
      mergeConfidence: mergeInfo?.confidence,
      wordsDropped: mergeInfo?.mergeIndex || 0,
      matchedWords: mergeInfo?.matchedWords,
    });

    // Render raw chunk data for debugging (with merge info)
    if (rawAsr) {
      this.renderRawChunk(chunkIndex, rawAsr, overlapDuration, mergeInfo);
    }

    // Store transcription data for saving with recording
    if (rawAsr && this.isRecording && !this.isViewingRecording) {
      this.sessionTranscriptionData.push({
        chunkIndex,
        rawAsr,
        overlapDuration: overlapDuration || 0,
        mergeInfo: mergeInfo || null,
        debug: debug || null,
        globalStartTime,
        timestamp: Date.now(),
      });
    }

    // Update global time offset
    // With overlap merging, we process the full audio minus overlap
    const audioDuration = audio ? audio.length / 16000 : 0;
    const newAudioProcessed = audioDuration - (overlapDuration || 0);
    this.globalTimeOffset += Math.max(0, newAudioProcessed);

    // Store result for next chunk's overlap comparison (unless final)
    if (!isFinal && transcript?.chunks?.length > 0) {
      this.lastChunkResult = {
        words: transcript.chunks, // Original words (not the filtered ones)
        endTime: globalStartTime + audioDuration,
      };
    } else {
      this.lastChunkResult = null;
    }

    // Process transcript if we have words to use
    if (wordsToUse.length > 0) {
      // Create a modified transcript with the filtered words
      const filteredTranscript = {
        ...transcript,
        chunks: wordsToUse,
        text: wordsToUse.map((w) => w.text).join(''),
      };

      // Calculate chunk start time for transcript display
      const chunkStartTime = globalStartTime + (overlapDuration || 0);

      // Merge ASR with phrase-based diarization
      const mergedSegments = this.transcriptMerger.merge(
        filteredTranscript,
        phrasesToUse,
        chunkStartTime
      );

      // Render and store segments
      if (mergedSegments.length > 0) {
        // Process each segment through inference layer
        const baseIndex = this.transcriptMerger.segments.length;
        for (let i = 0; i < mergedSegments.length; i++) {
          const segment = mergedSegments[i];
          const segmentIndex = baseIndex + i;

          // Process through inference (builds hypothesis, applies boosting)
          const { attribution } = this.conversationInference.processNewSegment(segment, segmentIndex);

          // Attach inference attribution to segment for rendering
          segment.inferenceAttribution = attribution;
        }

        this.renderSegments(mergedSegments);
        this.transcriptMerger.segments.push(...mergedSegments);

        // Log segment creation with clustering info
        this.debugLogger.logSegmentCreation({
          chunkIndex,
          segmentCount: mergedSegments.length,
          segments: mergedSegments.map(s => ({
            text: s.text?.substring(0, 100),
            speaker: s.speakerLabel,
            startTime: s.startTime,
            endTime: s.endTime,
            duration: s.endTime - s.startTime,
            isEnvironmental: s.isEnvironmental,
            clusteringReason: s.debug?.clustering?.reason,
            similarity: s.debug?.clustering?.similarity,
            margin: s.debug?.clustering?.margin,
          })),
        });

        // Update participants panel
        this.updateParticipantsPanel();
      }
    }

    // Update status
    this.updateRecordingStatus(processingTime);

    // Continue processing queue
    this.isProcessingChunk = false;

    // Update chunk queue visualization (after isProcessingChunk is false)
    this.updateChunkQueueViz();

    this.processNextChunk();
  }

  /**
   * Update recording status with timing info
   */
  updateRecordingStatus(processingTime) {
    const queuedCount = this.chunkQueue.length;
    const pendingCount = this.pendingChunks.size;
    const totalPending = queuedCount + pendingCount;

    if (this.isRecording) {
      let status = `Recording... (Last chunk: ${(processingTime / 1000).toFixed(1)}s processing)`;
      if (queuedCount > 0) {
        status += ` [${queuedCount} queued]`;
      }
      this.recordingStatus.textContent = status;
    } else if (totalPending > 0) {
      this.recordingStatus.textContent = `Processing ${totalPending} remaining chunk(s)...`;
      this.updateStatusBar('processing');
    } else {
      this.recordingStatus.textContent = 'Recording stopped.';
      this.updateStatusBar('ready');
    }
  }

  /**
   * Render transcript segments to the display
   * @param {Object[]} segments - Segments to render
   * @param {Object} [options] - Render options
   * @param {boolean} [options.autoScroll=true] - Whether to auto-scroll to bottom after rendering
   */
  renderSegments(segments, options = {}) {
    const { autoScroll = true } = options;
    // Remove placeholder if present
    const placeholder = this.transcriptContainer.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Get the current segment count for indexing
    const baseIndex = this.transcriptContainer.querySelectorAll('.transcript-segment').length;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentIndex = baseIndex + i;

      const segmentEl = document.createElement('div');
      const labelEl = document.createElement('div');
      const textEl = document.createElement('div');
      textEl.className = 'segment-text';
      textEl.textContent = segment.text;

      // Feature 7: Add segment index for comparison mode
      segmentEl.dataset.segmentIndex = segmentIndex;

      // Get inference display info if available
      const inference = segment.inferenceAttribution;
      const displayInfo = inference?.displayInfo;
      const clustering = segment.debug?.clustering;

      // Build tooltip with key metrics
      const tooltipParts = [];
      if (clustering && !segment.isEnvironmental) {
        if (clustering.similarity != null) {
          tooltipParts.push(`Similarity: ${(clustering.similarity * 100).toFixed(1)}%`);
        }
        if (clustering.runnerUp) {
          tooltipParts.push(`Runner-up: ${clustering.runnerUp}`);
        }
        if (clustering.margin != null) {
          tooltipParts.push(`Margin: ${(clustering.margin * 100).toFixed(1)}%`);
        }
      }
      const duration = segment.endTime - segment.startTime;
      if (duration > 0) {
        tooltipParts.push(`Duration: ${duration.toFixed(1)}s`);
      }
      if (segment.isEnvironmental) {
        tooltipParts.push('Type: Environmental');
      } else if (segment.speaker === -1) {
        tooltipParts.push('Type: Unknown speaker');
      } else {
        tooltipParts.push('Type: Speech');
      }
      const tooltipText = tooltipParts.join('\n');

      // Build attribution debug elements (only for non-environmental speech)
      let reasonBadgeHtml = '';
      let boostHtml = '';
      let candidatesHtml = '';

      if (clustering && !segment.isEnvironmental) {
        // Feature 3: Decision reason badge
        const reason = clustering.reason;
        if (reason && REASON_BADGES[reason]) {
          const badge = REASON_BADGES[reason];
          reasonBadgeHtml = `<span class="reason-badge ${badge.cssClass}" title="${reason.replace(/_/g, ' ')}">${badge.label}</span>`;
        }

        // Feature 1: Similarity breakdown - vertical right-aligned bars
        const allSimilarities = clustering.allSimilarities;
        if (allSimilarities && allSimilarities.length > 0) {
          const sorted = [...allSimilarities].sort((a, b) => b.similarity - a.similarity);
          const boostedMatches = inference?.boostedAttribution?.debug?.allMatches || [];
          const visibleCount = 3; // Show top 3 by default
          const hasMore = sorted.length > visibleCount;

          // Build candidate bar rows
          const buildCandidateRow = (c, i, isVisible) => {
            const pct = (c.similarity * 100).toFixed(0);
            const pctNum = parseFloat(pct);
            // Use actual speaker index if available, fall back to position for old recordings
            const colorIdx = c.speakerIdx ?? i;
            const enrolledClass = c.enrolled ? 'enrolled' : 'discovered';
            const boostedInfo = boostedMatches.find(m => m.speakerName === c.speaker);
            const boostTag = boostedInfo?.wasBoosted ? '<span class="boost-tag">+BOOST</span>' : '';
            const visibilityClass = isVisible ? '' : 'hidden-candidate';
            // For low percentages, position text outside the bar
            const pctOutsideClass = pctNum < 45 ? 'pct-outside' : '';

            return `
              <div class="candidate-bar-row ${enrolledClass} ${visibilityClass} ${pctOutsideClass}" data-speaker-idx="${colorIdx % 6}">
                <span class="candidate-boost-area">${boostTag}</span>
                <div class="candidate-bar-container">
                  <span class="candidate-bar" style="width: ${pct}%"><span class="candidate-pct">${pct}%</span></span>
                </div>
                <span class="candidate-name">${c.speaker}</span>
              </div>
            `;
          };

          const candidateRows = sorted.map((c, i) => buildCandidateRow(c, i, i < visibleCount)).join('');

          // Build toggle button if there are more candidates
          const hiddenCount = sorted.length - visibleCount;
          const toggleHtml = hasMore ? `
            <button class="candidates-toggle" onclick="this.closest('.candidates-panel').classList.toggle('expanded'); this.innerHTML = this.closest('.candidates-panel').classList.contains('expanded') ? '<i class=\\'ti ti-chevrons-up\\'></i> Show less' : '<i class=\\'ti ti-chevrons-down\\'></i> See ${hiddenCount} more'">
              <i class="ti ti-chevrons-down"></i> See ${hiddenCount} more
            </button>
          ` : '';

          candidatesHtml = `
            <div class="candidates-panel">
              ${candidateRows}
              ${toggleHtml}
            </div>
          `;
        }

        // Feature 2: Enhanced boost indicator with delta
        if (displayInfo?.wasInfluenced && inference?.originalAttribution && inference?.boostedAttribution) {
          const originalSim = inference.originalAttribution.debug?.similarity;
          const boostedSim = inference.boostedAttribution.similarity;
          if (originalSim != null && boostedSim != null) {
            const delta = boostedSim - originalSim;
            boostHtml = `
              <span class="boost-indicator enhanced" title="Boosted by conversation context">
                <span class="boost-delta">+${(delta * 100).toFixed(0)}%</span>
                <span class="boost-original">(was ${(originalSim * 100).toFixed(0)}%)</span>
              </span>
            `;
          } else {
            boostHtml = '<span class="boost-indicator" title="Boosted by conversation context"></span>';
          }
        }
      }

      // Build alternate speaker HTML if inference suggests ambiguity
      let alternateHtml = '';
      if (displayInfo?.showAlternate && displayInfo?.alternateLabel) {
        alternateHtml = ` <span class="alternate-speaker">(${displayInfo.alternateLabel}?)</span>`;
      }

      // Determine margin confidence class for ambiguity highlighting
      let marginClass = '';
      if (clustering?.margin != null && !segment.isEnvironmental) {
        if (clustering.margin >= 0.15) {
          marginClass = 'margin-high';
        } else if (clustering.margin >= 0.05) {
          marginClass = 'margin-medium';
        } else {
          marginClass = 'margin-low';
        }
      }

      // Set tooltip on segment
      if (tooltipText) {
        segmentEl.title = tooltipText;
      }

      if (segment.isEnvironmental || segment.speaker === null) {
        // Environmental sound - gray box, no speaker label
        segmentEl.className = 'transcript-segment environmental';
        labelEl.className = 'speaker-label environmental';
        labelEl.innerHTML = `
          <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
        `;
      } else if (segment.speaker === -1) {
        // Unknown speaker - distinct styling to indicate unassignable
        segmentEl.className = `transcript-segment unknown-speaker ${marginClass}`.trim();
        labelEl.className = 'speaker-label unknown-speaker';

        // Use inference label if available (might show alternate)
        const label = displayInfo?.label || segment.speakerLabel || 'Unknown';
        labelEl.innerHTML = `
          <div class="segment-header">
            <span class="speaker-name">${label}</span>${alternateHtml}${reasonBadgeHtml}${boostHtml}
            <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
          </div>
        `;
      } else {
        // Regular speaker segment
        const speakerClass = `speaker-${segment.speaker % 6}`;
        segmentEl.className = `transcript-segment ${speakerClass} ${marginClass}`.trim();
        labelEl.className = `speaker-label ${speakerClass}`;

        // Use inference label if available
        const label = displayInfo?.label || segment.speakerLabel;
        labelEl.innerHTML = `
          <div class="segment-header">
            <span class="speaker-name">${label}</span>${alternateHtml}${reasonBadgeHtml}${boostHtml}
            <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
          </div>
        `;
      }

      // Build two-column layout: main content (left) + candidates panel (right)
      const mainDiv = document.createElement('div');
      mainDiv.className = 'segment-main';
      mainDiv.appendChild(labelEl);
      mainDiv.appendChild(textEl);

      if (candidatesHtml) {
        const wrapper = document.createElement('div');
        wrapper.className = 'segment-content-wrapper';
        wrapper.appendChild(mainDiv);
        wrapper.insertAdjacentHTML('beforeend', candidatesHtml);
        segmentEl.appendChild(wrapper);
      } else {
        segmentEl.appendChild(mainDiv);
      }

      // Feature 7: Add click handler for comparison mode
      segmentEl.addEventListener('click', () => {
        if (this.comparisonMode) {
          this.selectSegmentForComparison(segmentIndex);
        }
      });

      this.transcriptContainer.appendChild(segmentEl);
    }

    // Auto-scroll to bottom (only during live recording, not when loading saved recordings)
    if (autoScroll) {
      this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
    }

    // Enable export all button when viewing recording with jobs
    if (segments.length > 0 && this.isViewingRecording) {
      this.exportAllJobsBtn.disabled = false;
    }
  }

  /**
   * Show processing indicator
   */
  showProcessingIndicator() {
    let indicator = this.transcriptContainer.querySelector('.processing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'processing-indicator';
      indicator.textContent = 'Processing audio...';
      this.transcriptContainer.appendChild(indicator);
    }
    this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
  }

  /**
   * Hide processing indicator
   */
  hideProcessingIndicator() {
    const indicator = this.transcriptContainer.querySelector('.processing-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Format time as MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Update audio level visualization
   */
  updateAudioLevel(level) {
    // Amplify for visibility (typical speech is quiet)
    const normalizedLevel = Math.min(level * 8, 1);
    this.audioVisualizer.style.background = `linear-gradient(to right,
      #3b82f6 ${normalizedLevel * 100}%,
      #e2e8f0 ${normalizedLevel * 100}%)`;

    // Update buffer bar in status bar (via Alpine event)
    this.bufferFillPercent = Math.round(normalizedLevel * 100);
    window.dispatchEvent(
      new CustomEvent('buffer-update', { detail: { percent: this.bufferFillPercent } })
    );
  }

  /**
   * Update status bar state (via Alpine event)
   */
  updateStatusBar(state) {
    const statusTexts = {
      ready: 'Ready',
      recording: 'Recording',
      processing: 'Processing',
      loading: 'Loading models...',
    };

    window.dispatchEvent(
      new CustomEvent('status-update', {
        detail: { status: state, text: statusTexts[state] || 'Ready' },
      })
    );
  }

  /**
   * Update status bar metrics with timing data (via Alpine event)
   */
  updateStatusBarMetrics(debug, totalTime) {
    const embedTime = debug.embeddingTime || 0;
    window.dispatchEvent(
      new CustomEvent('metrics-update', {
        detail: {
          asr: `${debug.asrTime}ms`,
          embed: `${embedTime}ms`,
          total: `${Math.round(totalTime)}ms`,
        },
      })
    );
  }

  /**
   * Update chunk queue visualization in status bar (via Alpine event)
   * Shows current processing activity with compact display
   */
  updateChunkQueueViz() {
    const pendingCount = this.pendingChunks.size;
    const queuedCount = this.chunkQueue.length;
    const isActive = this.isRecording || this.isProcessingChunk || pendingCount > 0 || queuedCount > 0;

    // Determine status text
    let chunkStatus;
    if (this.isProcessingChunk) {
      chunkStatus = `#${this.completedChunks + 1} processing`;
    } else if (pendingCount > 0 || queuedCount > 0) {
      chunkStatus = `${queuedCount} queued`;
    } else if (this.isRecording) {
      chunkStatus = 'Listening...';
    } else if (this.completedChunks > 0) {
      chunkStatus = `${this.completedChunks} done`;
    } else {
      chunkStatus = 'Idle';
    }

    // Build slot states array
    const slots = [false, false, false, false, false];
    if (isActive) {
      if (this.isProcessingChunk) {
        slots[0] = true;
      }
      for (let i = 1; i <= Math.min(queuedCount, 4); i++) {
        slots[i] = true;
      }
    }

    window.dispatchEvent(
      new CustomEvent('chunk-queue-update', {
        detail: { status: chunkStatus, slots },
      })
    );
  }

  /**
   * Clear transcript display only
   */
  clearTranscriptDisplay() {
    this.transcriptContainer.innerHTML =
      '<p class="placeholder">Transcript will appear here when you start recording...</p>';
    this.transcriptContainer.scrollTop = 0;
  }

  /**
   * Clear raw chunks display and data
   */
  clearRawChunksDisplay() {
    this.rawChunksData = [];
    if (this.rawChunksContainer) {
      this.rawChunksContainer.innerHTML =
        '<p class="placeholder">Raw chunk data will appear here...</p>';
    }
    if (this.exportRawBtn) {
      this.exportRawBtn.disabled = true;
    }
  }

  /**
   * Render raw chunk data from Whisper
   * Shows word-by-word output with timestamps, overlap regions, and merge info
   */
  renderRawChunk(chunkIndex, rawAsr, overlapDuration, mergeInfo) {
    if (!this.rawChunksContainer || !rawAsr) return;

    // Store raw chunk data for export
    this.rawChunksData.push({
      chunkIndex,
      rawAsr,
      overlapDuration,
      mergeInfo,
      timestamp: Date.now(),
    });

    // Enable export button
    if (this.exportRawBtn) {
      this.exportRawBtn.disabled = false;
    }

    // Remove placeholder if present
    const placeholder = this.rawChunksContainer.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    const { allWords, audioDuration } = rawAsr;

    // Create chunk element
    const chunkEl = document.createElement('div');
    chunkEl.className = 'raw-chunk';

    // Header with chunk info
    const headerEl = document.createElement('div');
    headerEl.className = 'raw-chunk-header';

    // Build merge info string
    let mergeStr = '';
    if (mergeInfo) {
      const conf = (mergeInfo.confidence * 100).toFixed(0);
      mergeStr = ` | merge: ${mergeInfo.method} (${conf}%)`;
    }

    headerEl.innerHTML = `
      <span class="chunk-label">Chunk #${chunkIndex + 1}</span>
      <span class="chunk-meta">
        ${audioDuration.toFixed(1)}s audio |
        ${allWords.length} words |
        overlap: ${overlapDuration.toFixed(2)}s${mergeStr}
      </span>
    `;
    chunkEl.appendChild(headerEl);

    // Words container
    const wordsEl = document.createElement('div');
    wordsEl.className = 'raw-words';

    // Determine merge point for highlighting
    const mergeIndex = mergeInfo?.mergeIndex || 0;

    for (let i = 0; i < allWords.length; i++) {
      const word = allWords[i];
      const wordEl = document.createElement('span');
      const startTime = word.timestamp?.[0] ?? 0;
      const endTime = word.timestamp?.[1] ?? 0;

      // Check if word is in overlap region
      const isInOverlap = startTime < overlapDuration;

      // Check if word was merged (removed due to overlap)
      const isMerged = isInOverlap && i < mergeIndex;

      // Check if word is kept (after merge point)
      const isKept = !isMerged;

      wordEl.className = 'raw-word';
      if (isKept) {
        wordEl.classList.add('kept');
      } else {
        wordEl.classList.add('merged');
      }
      if (isInOverlap) {
        wordEl.classList.add('overlap');
      }

      wordEl.innerHTML = `
        <span class="word-text">${this.escapeHtml(word.text)}</span>
        <span class="word-time">${startTime.toFixed(2)}-${endTime.toFixed(2)}</span>
      `;

      let tooltip = `${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s`;
      if (isInOverlap) tooltip += ' (overlap)';
      if (isMerged) tooltip += ' (merged out)';
      wordEl.title = tooltip;

      wordsEl.appendChild(wordEl);
    }

    chunkEl.appendChild(wordsEl);

    // Summary line
    const summaryEl = document.createElement('div');
    summaryEl.className = 'raw-chunk-summary';
    if (mergeInfo && mergeInfo.mergeIndex > 0) {
      summaryEl.textContent = `Merged ${mergeInfo.mergeIndex} overlapping words (${mergeInfo.method}, ${(mergeInfo.confidence * 100).toFixed(0)}% confidence)`;
    } else if (overlapDuration > 0) {
      summaryEl.textContent = `${allWords.length} words (first chunk or no overlap match)`;
    } else {
      summaryEl.textContent = `${allWords.length} words`;
    }
    chunkEl.appendChild(summaryEl);

    this.rawChunksContainer.appendChild(chunkEl);

    // Auto-scroll to bottom
    this.rawChunksContainer.scrollTop = this.rawChunksContainer.scrollHeight;
  }

  /**
   * Clear transcript (user action)
   */
  clearTranscript() {
    this.transcriptMerger.reset();
    this.conversationInference.reset();
    this.clearTranscriptDisplay();
    this.clearRawChunksDisplay();
    this.exportAllJobsBtn.disabled = true;

    // Reset participants panel
    if (this.participantsPanel) {
      this.participantsPanel.reset();
    }
  }

  /**
   * Copy job transcript as JSON to clipboard
   * @param {string} jobId - Job ID to copy
   */
  async copyJobJson(jobId) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      const job = await this.recordingStore.getJob(this.viewedRecordingId, jobId);
      if (!job || job.status !== 'processed' || !job.segments) {
        console.warn('[Export] Job not processed or has no segments');
        return;
      }

      const exportData = this._buildJobExportData(job);
      const json = JSON.stringify(exportData, null, 2);

      await navigator.clipboard.writeText(json);
      console.log(`[Export] Copied job "${job.name}" to clipboard`);

      // Dispatch event for UI feedback
      window.dispatchEvent(new CustomEvent('job-copied', { detail: { jobId } }));
    } catch (err) {
      console.error('[Export] Failed to copy job:', err);
    }
  }

  /**
   * Export job transcript as JSON file
   * @param {string} jobId - Job ID to export
   */
  async exportJob(jobId) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      const recording = await this.recordingStore.get(this.viewedRecordingId);
      const job = await this.recordingStore.getJob(this.viewedRecordingId, jobId);
      if (!job || job.status !== 'processed' || !job.segments) {
        console.warn('[Export] Job not processed or has no segments');
        return;
      }

      const exportData = this._buildJobExportData(job, recording);
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const safeName = (job.name || 'job').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`[Export] Exported job "${job.name}"`);
    } catch (err) {
      console.error('[Export] Failed to export job:', err);
    }
  }

  /**
   * Export all jobs for the current recording
   */
  async exportAllJobs() {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      const recording = await this.recordingStore.get(this.viewedRecordingId);
      if (!recording || !recording.jobs || recording.jobs.length === 0) {
        console.warn('[Export] No jobs to export');
        return;
      }

      const processedJobs = recording.jobs.filter(j => j.status === 'processed' && j.segments);
      if (processedJobs.length === 0) {
        console.warn('[Export] No processed jobs to export');
        return;
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        recording: {
          id: recording.id,
          name: recording.name,
          duration: recording.duration,
          createdAt: recording.createdAt,
        },
        jobCount: processedJobs.length,
        jobs: processedJobs.map(job => this._buildJobExportData(job)),
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const safeName = (recording.name || 'recording').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}-all-jobs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Brief feedback
      const originalText = this.exportAllJobsBtn.textContent;
      this.exportAllJobsBtn.innerHTML = '<i class="ti ti-check"></i> Exported!';
      setTimeout(() => {
        this.exportAllJobsBtn.innerHTML = originalText;
      }, 2000);

      console.log(`[Export] Exported ${processedJobs.length} jobs for "${recording.name}"`);
    } catch (err) {
      console.error('[Export] Failed to export all jobs:', err);
    }
  }

  /**
   * Build export data structure for a job
   * @param {Object} job - Job object
   * @param {Object} [recording] - Optional recording for additional context
   * @returns {Object} Export data
   */
  _buildJobExportData(job, recording = null) {
    return {
      job: {
        id: job.id,
        name: job.name,
        notes: job.notes,
        status: job.status,
        createdAt: job.createdAt,
        processedAt: job.processedAt,
        settings: job.settings,
      },
      ...(recording && {
        recording: {
          id: recording.id,
          name: recording.name,
          duration: recording.duration,
        },
      }),
      segmentCount: job.segments?.length || 0,
      participants: job.participants || [],
      segments: (job.segments || []).map((seg) => ({
        text: seg.text?.trim() || '',
        speaker: seg.speaker,
        speakerLabel: seg.speakerLabel,
        startTime: seg.startTime,
        endTime: seg.endTime,
        isEnvironmental: seg.isEnvironmental || false,
        words: seg.words,
        attribution: seg.debug?.clustering
          ? {
              similarity: seg.debug.clustering.similarity,
              secondBestSimilarity: seg.debug.clustering.secondBestSimilarity,
              margin: seg.debug.clustering.margin,
              secondBestSpeaker: seg.debug.clustering.secondBestSpeaker,
              isEnrolled: seg.debug.clustering.isEnrolled,
              reason: seg.debug.clustering.reason,
            }
          : null,
        debug: {
          duration: seg.debug?.duration,
          frameCount: seg.debug?.frameCount,
          type: seg.debug?.type,
        },
      })),
    };
  }

  /**
   * Export raw chunks as JSON file
   */
  exportRawChunks() {
    if (this.rawChunksData.length === 0) return;

    const exportData = {
      exportedAt: new Date().toISOString(),
      chunkCount: this.rawChunksData.length,
      chunks: this.rawChunksData,
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `whisper-raw-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Brief feedback
    const originalText = this.exportRawBtn.textContent;
    this.exportRawBtn.textContent = 'Exported!';
    setTimeout(() => {
      this.exportRawBtn.textContent = originalText;
    }, 2000);
  }

  /**
   * Handle errors
   */
  handleError(error) {
    console.error('App error:', error);
    let message = 'An error occurred.';

    if (error.name === 'NotAllowedError') {
      message = 'Microphone access denied. Please allow microphone access and try again.';
    } else if (error.name === 'NotFoundError') {
      message = 'No microphone found. Please connect a microphone and try again.';
    } else if (error.message) {
      message = error.message;
    }

    this.recordingStatus.textContent = message;
    this.stopRecording();
  }

  // ==================== Inference Methods ====================

  /**
   * Update the participants panel with current hypothesis
   */
  async updateParticipantsPanel() {
    if (!this.participantsPanel) return;

    const hypothesis = this.conversationInference.getHypothesis();
    const enrollments = await EnrollmentManager.loadAll();
    const speakerStats = this.conversationInference.getAllSpeakerStatsForUI();
    const hypothesisHistory = this.conversationInference.getHypothesisHistory();
    this.participantsPanel.render(hypothesis, enrollments, speakerStats, hypothesisHistory);
  }

  /**
   * Handle retroactive attribution changes when hypothesis updates
   * @param {number[]} changedIndices - Indices of segments that changed
   */
  handleAttributionChange(changedIndices) {
    if (changedIndices.length === 0) return;

    // Update the stored segments with new attributions
    const segments = this.transcriptMerger.segments;
    for (const index of changedIndices) {
      if (index < segments.length) {
        const segment = segments[index];
        const attribution = this.conversationInference.getAttribution(index);
        if (attribution) {
          segment.inferenceAttribution = attribution;
        }
      }
    }

    // Re-render the changed segments in the DOM
    const segmentEls = this.transcriptContainer.querySelectorAll('.transcript-segment');
    for (const index of changedIndices) {
      if (index < segmentEls.length && index < segments.length) {
        const segment = segments[index];
        const segmentEl = segmentEls[index];

        // Get the label element
        const labelEl = segmentEl.querySelector('.speaker-label');
        if (!labelEl) continue;

        // Get updated display info
        const displayInfo = segment.inferenceAttribution?.displayInfo;
        if (!displayInfo) continue;

        // Rebuild the label content
        let alternateHtml = '';
        if (displayInfo.showAlternate && displayInfo.alternateLabel) {
          alternateHtml = ` <span class="alternate-speaker">(${displayInfo.alternateLabel}?)</span>`;
        }

        let boostHtml = '';
        if (displayInfo.wasInfluenced) {
          boostHtml = '<span class="boost-indicator" title="Boosted by conversation context"></span>';
        }

        // Get confidence HTML from existing content
        const confidenceEl = labelEl.querySelector('.segment-confidence');
        const confidenceHtml = confidenceEl ? confidenceEl.outerHTML : '';

        // Get timestamp from existing content
        const timestampEl = labelEl.querySelector('.timestamp');
        const timestampHtml = timestampEl ? timestampEl.outerHTML : '';

        // Update label
        const label = displayInfo.label || segment.speakerLabel;
        labelEl.innerHTML = `
          ${label}${alternateHtml}${boostHtml}
          ${timestampHtml}
          ${confidenceHtml}
        `;

        // Add flash animation to indicate change
        segmentEl.classList.add('segment-reattributed');
        setTimeout(() => {
          segmentEl.classList.remove('segment-reattributed');
        }, 500);
      }
    }

    // Update participants panel
    this.updateParticipantsPanel();

    console.log(`[Inference] Re-attributed ${changedIndices.length} segment(s) based on updated hypothesis`);
  }

  // ==================== Comparison Mode Methods (Feature 7) ====================

  /**
   * Toggle segment comparison mode on/off
   */
  toggleComparisonMode() {
    this.comparisonMode = !this.comparisonMode;
    this.selectedSegments = [];

    // Update UI
    this.updateComparisonModeUI();

    // Dispatch event for Alpine components
    window.dispatchEvent(new CustomEvent('comparison-mode-changed', {
      detail: { enabled: this.comparisonMode },
    }));

    console.log(`[Comparison] Mode ${this.comparisonMode ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update UI elements for comparison mode state
   */
  updateComparisonModeUI() {
    // Toggle class on transcript container
    if (this.comparisonMode) {
      this.transcriptContainer.classList.add('comparison-mode');
    } else {
      this.transcriptContainer.classList.remove('comparison-mode');
      // Clear any selected segments
      this.transcriptContainer.querySelectorAll('.comparison-selected').forEach(el => {
        el.classList.remove('comparison-selected');
      });
    }

    // Hide comparison result when mode is toggled off
    if (!this.comparisonMode) {
      this.hideComparisonResult();
    }
  }

  /**
   * Handle segment click for comparison selection
   * @param {number} index - Index of the clicked segment
   */
  selectSegmentForComparison(index) {
    if (!this.comparisonMode) return;

    const segmentEls = this.transcriptContainer.querySelectorAll('.transcript-segment');
    if (index >= segmentEls.length) return;

    const segmentEl = segmentEls[index];
    const existingIdx = this.selectedSegments.indexOf(index);

    if (existingIdx !== -1) {
      // Deselect
      this.selectedSegments.splice(existingIdx, 1);
      segmentEl.classList.remove('comparison-selected');
    } else if (this.selectedSegments.length < 2) {
      // Select
      this.selectedSegments.push(index);
      segmentEl.classList.add('comparison-selected');
    }

    // If we have 2 segments selected, show comparison
    if (this.selectedSegments.length === 2) {
      this.showComparisonResult();
    } else {
      this.hideComparisonResult();
    }
  }

  /**
   * Show comparison result between two selected segments
   */
  showComparisonResult() {
    const segments = this.transcriptMerger.segments;
    const idx1 = this.selectedSegments[0];
    const idx2 = this.selectedSegments[1];

    if (idx1 >= segments.length || idx2 >= segments.length) return;

    const seg1 = segments[idx1];
    const seg2 = segments[idx2];

    // Check if both segments have embeddings
    if (!seg1.embedding || !seg2.embedding) {
      this.displayComparisonResult({
        error: 'One or both segments lack embeddings',
        segment1: { index: idx1, speaker: seg1.speakerLabel, text: seg1.text.substring(0, 40) },
        segment2: { index: idx2, speaker: seg2.speakerLabel, text: seg2.text.substring(0, 40) },
      });
      return;
    }

    // Compute cosine similarity
    const similarity = cosineSimilarity(
      new Float32Array(seg1.embedding),
      new Float32Array(seg2.embedding),
    );

    // Determine if likely same speaker (using clustering threshold)
    const sameSpeakerLikely = similarity >= 0.75;
    const sameSpeakerActual = seg1.speaker === seg2.speaker;

    this.displayComparisonResult({
      segment1: { index: idx1, speaker: seg1.speakerLabel, text: seg1.text.substring(0, 40) },
      segment2: { index: idx2, speaker: seg2.speakerLabel, text: seg2.text.substring(0, 40) },
      similarity,
      sameSpeakerLikely,
      sameSpeakerActual,
    });
  }

  /**
   * Display comparison result in UI
   * @param {Object} result - Comparison result data
   */
  displayComparisonResult(result) {
    // Dispatch event for Alpine component to display
    window.dispatchEvent(new CustomEvent('comparison-result', { detail: result }));
  }

  /**
   * Hide comparison result
   */
  hideComparisonResult() {
    window.dispatchEvent(new CustomEvent('comparison-result', { detail: null }));
  }

  // ==================== Recording Management Methods ====================

  /**
   * Load the list of saved recordings and notify Alpine
   */
  async loadRecordingsList() {
    try {
      const recordings = await this.recordingStore.getAll();
      window.dispatchEvent(new CustomEvent('recordings-updated', {
        detail: { recordings: recordings.map(r => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          duration: r.duration,
          segmentCount: r.metadata?.segmentCount || 0,
          speakerCount: r.participants?.length || 0,
          sizeBytes: r.metadata?.sizeBytes || 0,
        }))},
      }));
    } catch (error) {
      console.error('Failed to load recordings list:', error);
    }
  }

  /**
   * Save the current recording session (v2 job-based schema)
   */
  async saveCurrentSession() {
    if (this.sessionAudioChunks.length === 0) {
      console.log('[Recording] No audio chunks to save');
      return;
    }

    const segments = this.transcriptMerger.getTranscript();
    if (segments.length === 0) {
      console.log('[Recording] No segments to save');
      this.sessionAudioChunks = []; // Clear chunks even if no segments
      return;
    }

    try {
      // Calculate duration from segments
      const lastSegment = segments[segments.length - 1];
      const duration = lastSegment.endTime || 0;

      // Get current enrollments snapshot
      const enrollmentsSnapshot = await EnrollmentManager.loadAll();

      // Extract participants from segments
      const participants = this._extractParticipants(segments);

      // Serialize chunks and transcription data
      const serializedChunks = serializeChunks(this.sessionAudioChunks);
      const serializedTranscriptionData = serializeTranscriptionData(this.sessionTranscriptionData);

      // Calculate storage size (includes transcription data)
      const sizeBytes = calculateStorageSize(segments, this.sessionAudioChunks, this.sessionTranscriptionData);

      // Use liveJob settings if available, otherwise build fresh from global state
      let jobSettings;
      if (this.liveJob?.settings) {
        // Clone settings from live job (what user configured)
        jobSettings = JSON.parse(JSON.stringify(this.liveJob.settings));
      } else {
        // Fallback: build from global state
        const embeddingModelId = ModelSelectionStore.getEmbeddingModel();
        const segmentationModelId = SegmentationModelStore.getSegmentationModel();
        const segmentationParams = SegmentationModelStore.getParams(segmentationModelId);
        jobSettings = buildJobSettings({
          embeddingModelId,
          segmentationModelId,
          segmentationParams,
          clustering: { numSpeakers: this.numSpeakers },
          enrollmentSource: ENROLLMENT_SOURCE.SNAPSHOT,
        });
      }

      // Create the first job with processed results
      const job = createJob({
        name: 'Live Recording',
        settings: jobSettings,
        status: JOB_STATUS.PROCESSED,
      });
      job.processedAt = Date.now();
      job.segments = segments;
      job.participants = participants;

      // Create recording (v2 schema) as container for jobs
      const recording = {
        id: generateRecordingId(),
        name: generateRecordingName(),
        createdAt: Date.now(),
        duration,
        enrollmentsSnapshot,
        metadata: {
          chunkCount: this.sessionAudioChunks.length,
          sizeBytes,
        },
        jobs: [job],
        activeJobId: job.id,
        // schemaVersion is set by recordingStore.save()
      };

      // Save to IndexedDB
      await this.recordingStore.save(recording, serializedChunks, serializedTranscriptionData);

      // Enforce max recordings limit
      const deleted = await this.recordingStore.enforceMaxRecordings();
      if (deleted > 0) {
        console.log(`[Recording] Auto-deleted ${deleted} old recording(s)`);
      }

      // Clear session data
      this.sessionAudioChunks = [];
      this.sessionTranscriptionData = [];

      // Update recordings list
      await this.loadRecordingsList();

      console.log(`[Recording] Saved "${recording.name}" (${formatDuration(duration)}, ${formatFileSize(sizeBytes)})`);

      // Auto-load the saved recording for immediate playback
      await this.loadRecording(recording.id, job.id);

      console.log(`[Recording] Saved and loaded "${recording.name}"`);
    } catch (error) {
      console.error('[Recording] Failed to save:', error);
      this.recordingStatus.textContent = 'Failed to save recording';
    }
  }

  /**
   * Extract participants from segments
   * @param {Object[]} segments
   * @returns {Object[]} participants
   */
  _extractParticipants(segments) {
    const speakerSet = new Map();
    for (const seg of segments) {
      if (seg.speaker != null && !seg.isEnvironmental) {
        if (!speakerSet.has(seg.speaker)) {
          speakerSet.set(seg.speaker, {
            speakerId: seg.speaker,
            label: seg.speakerLabel,
            name: seg.speakerName || null,
            segmentCount: 0,
            isEnrolled: seg.isEnrolledSpeaker || false,
          });
        }
        speakerSet.get(seg.speaker).segmentCount++;
      }
    }
    return Array.from(speakerSet.values());
  }

  /**
   * Load and display a saved recording (v2 job-based schema)
   * @param {string} recordingId
   * @param {string} [jobId] - Optional specific job ID to display (defaults to activeJobId)
   */
  async loadRecording(recordingId, jobId = null) {
    if (this.isRecording) {
      this.recordingStatus.textContent = 'Stop recording before loading a saved recording';
      return;
    }

    try {
      this.recordingStatus.textContent = 'Loading recording...';
      this.updateStatusBar('processing');

      const data = await this.recordingStore.getWithChunks(recordingId);
      if (!data) {
        this.recordingStatus.textContent = 'Recording not found';
        this.updateStatusBar('ready');
        return;
      }

      const { recording, chunks, transcriptionData } = data;

      // Find the job to display (specified or active)
      const targetJobId = jobId || recording.activeJobId;
      const activeJob = recording.jobs.find((j) => j.id === targetJobId);
      if (!activeJob) {
        this.recordingStatus.textContent = 'Job not found';
        this.updateStatusBar('ready');
        return;
      }

      // Set viewing state
      this.isViewingRecording = true;
      this.viewedRecordingId = recordingId;
      this.viewedJobId = activeJob.id;

      // Store references for re-processing (e.g., when boosting config changes)
      this._currentViewedSegments = activeJob.segments || [];
      this._currentViewedEnrollments = recording.enrollmentsSnapshot || [];
      this._currentViewedJob = activeJob;
      this._currentViewedRecording = recording;

      // Clear current display
      this.clearTranscriptDisplay();
      this.clearRawChunksDisplay();

      // Initialize inference with recording data for accurate participants panel
      this.conversationInference.reset();
      const enrollments = recording.enrollmentsSnapshot || [];
      this.conversationInference.setEnrolledSpeakers(enrollments);
      this.conversationInference.setExpectedSpeakers(activeJob.settings?.clustering?.numSpeakers || this.numSpeakers);

      // Process each segment through inference to build hypothesis
      // Use saved inferenceAttribution if present, otherwise rebuild from debug.clustering
      const segments = activeJob.segments || [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (segment.inferenceAttribution) {
          // Use saved attribution directly - preserves original boost decisions
          this.conversationInference.segmentAttributions[i] = segment.inferenceAttribution;
        } else if (segment.debug?.clustering?.allSimilarities) {
          // Rebuild attribution from clustering data (for older recordings)
          const { attribution } = this.conversationInference.processNewSegment(segment, i);
          segment.inferenceAttribution = attribution;
        }
      }

      // Render saved segments using the same renderer as live recording
      // This ensures colors, similarity bars, reason badges, and boost indicators display correctly
      this.renderSegments(segments, { autoScroll: false });

      // Render raw chunk data if available (for recordings saved with transcription data)
      // Uses the same renderRawChunk() as live recording for identical display
      if (transcriptionData && transcriptionData.length > 0) {
        for (const chunk of transcriptionData) {
          this.renderRawChunk(chunk.chunkIndex, chunk.rawAsr, chunk.overlapDuration, chunk.mergeInfo);
        }
      }

      // Update participants panel with recording's inference data
      this.updateParticipantsPanel();

      // Initialize audio playback with deserialized chunks
      const audioChunks = deserializeChunks(chunks);

      // Clean up previous playback if any
      if (this.audioPlayback) {
        this.audioPlayback.destroy();
      }

      // Create new playback instance
      this.audioPlayback = new AudioPlayback({
        onProgress: (progress) => {
          window.dispatchEvent(new CustomEvent('playback-progress', { detail: progress }));
        },
        onEnded: () => {
          console.log('[Recording] Playback ended');
        },
      });

      // Load audio chunks
      await this.audioPlayback.load(audioChunks);

      // Notify Alpine with full job information
      window.dispatchEvent(new CustomEvent('recording-loaded', {
        detail: {
          id: recording.id,
          name: recording.name,
          duration: recording.duration,
          enrollmentsSnapshot: recording.enrollmentsSnapshot,
          participants: activeJob.participants || [],
          jobs: recording.jobs,
          activeJobId: activeJob.id,
          activeJob: activeJob,
        },
      }));

      this.recordingStatus.textContent = `Viewing: ${recording.name}`;
      this.updateStatusBar('ready');

      console.log(`[Recording] Loaded "${recording.name}" - Job: "${activeJob.name}"`);
    } catch (error) {
      console.error('[Recording] Failed to load:', error);
      this.recordingStatus.textContent = 'Failed to load recording';
      this.updateStatusBar('ready');
    }
  }

  /**
   * Return to live recording mode (exit viewing mode)
   */
  returnToLive() {
    if (!this.isViewingRecording) return;

    this.isViewingRecording = false;
    this.viewedRecordingId = null;
    this.viewedJobId = null;
    this._currentViewedSegments = null;
    this._currentViewedEnrollments = null;
    this._currentViewedJob = null;
    this._currentViewedRecording = null;

    // Clean up audio playback
    if (this.audioPlayback) {
      this.audioPlayback.destroy();
      this.audioPlayback = null;
    }

    // Clear display
    this.clearTranscriptDisplay();
    this.clearRawChunksDisplay();

    // Notify Alpine
    window.dispatchEvent(new CustomEvent('recording-closed'));

    // Create fresh live job for new session
    this.liveJob = this._createFreshLiveJob();
    this._dispatchLiveJobState();

    this.recordingStatus.textContent = 'Ready';
    this.updateStatusBar('ready');
  }

  /**
   * Toggle playback (play/pause)
   */
  togglePlayback() {
    if (!this.audioPlayback || !this.isViewingRecording) return;
    this.audioPlayback.toggle();
  }

  /**
   * Seek playback to a specific time
   * @param {number} time - Time in seconds
   */
  seekPlayback(time) {
    if (!this.audioPlayback || !this.isViewingRecording) return;
    this.audioPlayback.seek(time);
  }

  // ==================== Job Management Methods ====================

  /**
   * Switch to viewing a different job within the same recording
   * @param {string} jobId - Job ID to switch to
   */
  async switchJob(jobId) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;
    if (this.viewedJobId === jobId) return;

    const recordingId = this.viewedRecordingId;

    try {
      // Update activeJobId in storage
      await this.recordingStore.setActiveJob(recordingId, jobId);

      // Reload the recording with the new job
      await this.loadRecording(recordingId, jobId);

      console.log(`[Job] Switched to job: ${jobId}`);
    } catch (error) {
      console.error('[Job] Failed to switch job:', error);
      this.recordingStatus.textContent = 'Failed to switch job';
    }
  }

  /**
   * Create a new unprocessed job for the current recording
   * Uses current global settings as defaults
   */
  async createNewJob() {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    const recordingId = this.viewedRecordingId;

    try {
      // Get current model configuration
      const embeddingModelId = ModelSelectionStore.getEmbeddingModel();
      const segmentationModelId = SegmentationModelStore.getSegmentationModel();
      const segmentationParams = SegmentationModelStore.getParams(segmentationModelId);

      // Build job settings from current global state
      // Use CURRENT enrollments for new jobs since user is re-processing with new settings
      const jobSettings = buildJobSettings({
        embeddingModelId,
        segmentationModelId,
        segmentationParams,
        clustering: {
          numSpeakers: this.numSpeakers,
        },
        enrollmentSource: ENROLLMENT_SOURCE.CURRENT,
      });

      // Create new unprocessed job
      const newJob = createJob({
        settings: jobSettings,
        status: JOB_STATUS.UNPROCESSED,
      });

      // Add to recording and set as active
      await this.recordingStore.addJob(recordingId, newJob, true);

      // Reload to show the new job
      await this.loadRecording(recordingId, newJob.id);

      // Notify Alpine about job creation (for auto-opening settings)
      window.dispatchEvent(new CustomEvent('job-created', {
        detail: { jobId: newJob.id, job: newJob, isUnprocessed: true },
      }));

      console.log(`[Job] Created new job: ${newJob.name}`);
    } catch (error) {
      console.error('[Job] Failed to create job:', error);
      this.recordingStatus.textContent = 'Failed to create job';
    }
  }

  /**
   * Clone a job's settings to create a new unprocessed job
   * @param {string} sourceJobId - Job ID to clone from
   */
  async cloneJob(sourceJobId) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    const recordingId = this.viewedRecordingId;

    try {
      // Get the source job
      const sourceJob = await this.recordingStore.getJob(recordingId, sourceJobId);
      if (!sourceJob) {
        throw new Error('Source job not found');
      }

      // Import clone helper
      const { cloneJobSettings } = await import('./config/jobDefaults.js');

      // Clone the job
      const newJob = cloneJobSettings(sourceJob);

      // Add to recording and set as active
      await this.recordingStore.addJob(recordingId, newJob, true);

      // Reload to show the cloned job
      await this.loadRecording(recordingId, newJob.id);

      // Notify Alpine about job creation
      window.dispatchEvent(new CustomEvent('job-created', {
        detail: { jobId: newJob.id, job: newJob, isUnprocessed: true },
      }));

      console.log(`[Job] Cloned job "${sourceJob.name}" → "${newJob.name}"`);
    } catch (error) {
      console.error('[Job] Failed to clone job:', error);
      this.recordingStatus.textContent = 'Failed to clone job';
    }
  }

  /**
   * Delete a job from the current recording
   * @param {string} jobId - Job ID to delete
   */
  async deleteJob(jobId) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    const recordingId = this.viewedRecordingId;

    try {
      // Delete the job
      await this.recordingStore.deleteJob(recordingId, jobId);

      // Get the recording to find the new active job
      const recording = await this.recordingStore.get(recordingId);

      // Reload with the new active job
      await this.loadRecording(recordingId, recording.activeJobId);

      console.log(`[Job] Deleted job: ${jobId}`);
    } catch (error) {
      console.error('[Job] Failed to delete job:', error);
      this.recordingStatus.textContent = error.message || 'Failed to delete job';
    }
  }

  /**
   * Update a job's name
   * @param {string} jobId - Job ID
   * @param {string} name - New name
   * @param {boolean} [customized=true] - Whether this is a user customization (vs auto-generated)
   */
  async updateJobName(jobId, name, customized = true) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      const updates = { name };
      if (customized) {
        updates.nameCustomized = true;
      }
      await this.recordingStore.updateJob(this.viewedRecordingId, jobId, updates);
      console.log(`[Job] Updated name: ${name}${customized ? ' (customized)' : ' (auto)'}`);
    } catch (error) {
      console.error('[Job] Failed to update name:', error);
    }
  }

  /**
   * Update a job's notes
   * @param {string} jobId - Job ID
   * @param {string} notes - New notes
   */
  async updateJobNotes(jobId, notes) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      await this.recordingStore.updateJob(this.viewedRecordingId, jobId, { notes });
      console.log(`[Job] Updated notes`);
    } catch (error) {
      console.error('[Job] Failed to update notes:', error);
    }
  }

  /**
   * Update a job's settings (for unprocessed jobs)
   * @param {string} jobId - Job ID
   * @param {Object} settings - Updated settings object
   */
  async updateJobSettings(jobId, settings) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      await this.recordingStore.updateJob(this.viewedRecordingId, jobId, { settings });
      console.log(`[Job] Updated settings:`, settings.embeddingModel?.name, settings.segmentationModel?.name);
    } catch (error) {
      console.error('[Job] Failed to update settings:', error);
    }
  }

  /**
   * Process an unprocessed job
   * @param {string} jobId - Job ID to process
   * @param {string} [mode='quick'] - 'quick' (re-embed only) or 'full' (full pipeline)
   */
  async processJob(jobId, mode = 'quick') {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    if (this.isRecording) {
      this.recordingStatus.textContent = 'Stop recording before processing';
      return;
    }

    if (!this.isModelLoaded) {
      this.recordingStatus.textContent = 'Wait for models to load before processing';
      return;
    }

    const recordingId = this.viewedRecordingId;

    try {
      // Get job and verify it's unprocessed
      const job = await this.recordingStore.getJob(recordingId, jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      if (job.status === JOB_STATUS.PROCESSED) {
        this.recordingStatus.textContent = 'Job is already processed';
        return;
      }

      // Mark job as processing
      await this.recordingStore.updateJob(recordingId, jobId, { status: JOB_STATUS.PROCESSING });

      // Notify Alpine
      window.dispatchEvent(new CustomEvent('job-processing-start', {
        detail: { jobId, mode },
      }));

      this.recordingStatus.textContent = 'Loading recording for processing...';
      this.updateStatusBar('processing');

      // Load recording with chunks
      const data = await this.recordingStore.getWithChunks(recordingId);
      if (!data) {
        throw new Error('Recording not found');
      }

      const { recording, chunks, transcriptionData } = data;

      // Apply job settings to clusterer
      await this._applyJobSettings(job.settings);

      // Process based on mode
      let newSegments;
      if (mode === 'quick') {
        newSegments = await this._processJobQuick(recording, job, chunks);
      } else {
        newSegments = await this._processJobFull(recording, job, chunks, transcriptionData);
      }

      // Extract participants from new segments
      const participants = this._extractParticipants(newSegments);

      // Update job with results
      await this.recordingStore.updateJob(recordingId, jobId, {
        status: JOB_STATUS.PROCESSED,
        processedAt: Date.now(),
        segments: newSegments,
        participants,
      });

      // Notify Alpine
      window.dispatchEvent(new CustomEvent('job-processing-complete', {
        detail: { jobId, mode },
      }));

      // Reload to display the processed job
      await this.loadRecording(recordingId, jobId);

      this.updateStatusBar('ready');
      console.log(`[Job] Processed job "${job.name}" (${mode})`);
    } catch (error) {
      console.error('[Job] Processing failed:', error);

      // Revert job to unprocessed
      await this.recordingStore.updateJob(recordingId, jobId, { status: JOB_STATUS.UNPROCESSED });

      this.recordingStatus.textContent = 'Processing failed: ' + error.message;
      this.updateStatusBar('ready');

      window.dispatchEvent(new CustomEvent('job-processing-complete', {
        detail: { jobId, mode, error: error.message },
      }));
    }
  }

  /**
   * Apply job settings to the clusterer/inference system
   * @param {Object} settings - JobSettings object
   */
  async _applyJobSettings(settings) {
    // Get enrollments based on job's enrollment source
    let enrollments;
    if (settings.enrollmentSource === ENROLLMENT_SOURCE.CURRENT) {
      enrollments = await EnrollmentManager.loadAll();
    } else {
      // Use snapshot from recording
      enrollments = this._currentViewedEnrollments || [];
    }

    // CRITICAL: Prepare enrollments for the job's embedding model
    // Each enrollment stores per-model embeddings, and we need to use the
    // centroids that match the model being used for embedding extraction
    const modelId = settings.embeddingModel?.id || ModelSelectionStore.getEmbeddingModel();
    const preparedEnrollments = await this.prepareEnrollmentsForModel(enrollments, modelId);

    // Configure clusterer
    const clusterer = this.transcriptMerger.speakerClusterer;
    clusterer.reset();
    clusterer.similarityThreshold = settings.clustering?.similarityThreshold ?? 0.75;
    clusterer.confidenceMargin = settings.clustering?.confidenceMargin ?? 0.15;

    // Seed with model-prepared enrollments
    if (preparedEnrollments.length > 0) {
      clusterer.importEnrolledSpeakers(preparedEnrollments);
    }

    // Configure inference
    if (settings.boosting) {
      this.conversationInference.config.boostFactor = settings.boosting.boostFactor;
      this.conversationInference.config.ambiguityMarginThreshold = settings.boosting.ambiguityMarginThreshold;
      this.conversationInference.config.skipBoostIfConfident = settings.boosting.skipBoostIfConfident;
      this.conversationInference.config.minSimilarityForBoosting = settings.boosting.minSimilarityForBoosting;
      this.conversationInference.config.boostEligibilityRank = settings.boosting.boostEligibilityRank;
      this.conversationInference.config.minSimilarityAfterBoost = settings.boosting.minSimilarityAfterBoost;
    }

    this.conversationInference.reset();
    this.conversationInference.setEnrolledSpeakers(preparedEnrollments);
    this.conversationInference.setExpectedSpeakers(settings.clustering?.numSpeakers || this.numSpeakers);
  }

  /**
   * Quick job processing: keep ASR, re-extract embeddings, re-cluster
   * @param {Object} recording - Recording metadata
   * @param {Object} job - Job with settings
   * @param {Object[]} chunks - Serialized audio chunks
   * @returns {Promise<Object[]>} New segments
   */
  async _processJobQuick(recording, job, chunks) {
    this.recordingStatus.textContent = 'Processing (quick): preparing audio...';

    // Deserialize and combine audio chunks
    const audioChunks = deserializeChunks(chunks);
    const combinedAudio = combineChunks(audioChunks);

    // Get reference segments - use existing processed job's segments if available
    const existingJob = recording.jobs.find(j => j.status === JOB_STATUS.PROCESSED);
    const referenceSegments = existingJob?.segments || [];

    if (referenceSegments.length === 0) {
      throw new Error('No reference segments found - try full processing instead');
    }

    // Build segment audio slices from reference segment timings
    const segmentsToProcess = [];

    for (let i = 0; i < referenceSegments.length; i++) {
      const seg = referenceSegments[i];
      if (seg.startTime != null && seg.endTime != null && !seg.isEnvironmental) {
        const startSample = Math.floor(seg.startTime * 16000);
        const endSample = Math.ceil(seg.endTime * 16000);
        if (endSample > startSample && endSample <= combinedAudio.length) {
          segmentsToProcess.push({
            index: i,
            audio: Array.from(combinedAudio.slice(startSample, endSample)),
          });
        }
      }
    }

    if (segmentsToProcess.length === 0) {
      throw new Error('No segments to process');
    }

    this.recordingStatus.textContent = `Processing (quick): extracting embeddings 0/${segmentsToProcess.length}...`;

    // Request batch embedding extraction from worker
    const embeddings = await this.batchExtractEmbeddings(segmentsToProcess);

    // Create a map of new embeddings by segment index
    const embeddingMap = new Map();
    for (const result of embeddings) {
      if (result.embedding) {
        embeddingMap.set(result.index, new Float32Array(result.embedding));
      }
    }

    this.recordingStatus.textContent = 'Processing (quick): clustering speakers...';

    // Get clusterer (already configured by _applyJobSettings)
    const clusterer = this.transcriptMerger.speakerClusterer;

    // Build new segments with updated embeddings and speaker assignments
    const newSegments = referenceSegments.map((seg, i) => {
      const newSeg = { ...seg };

      if (seg.isEnvironmental) {
        return newSeg;
      }

      const newEmbedding = embeddingMap.get(i);
      if (newEmbedding) {
        newSeg.embedding = Array.from(newEmbedding);
        const result = clusterer.assignSpeaker(newEmbedding, true);
        newSeg.speaker = result.speakerId;
        newSeg.speakerLabel = clusterer.getSpeakerLabel(result.speakerId);
        newSeg.isEnrolledSpeaker = result.debug?.isEnrolled || false;
        newSeg.speakerName = clusterer.speakers[result.speakerId]?.name || null;
        newSeg.debug = { ...newSeg.debug, clustering: result.debug };
      }

      return newSeg;
    });

    return newSegments;
  }

  /**
   * Full job processing: re-run ASR, segmentation, and embeddings
   * @param {Object} recording - Recording metadata
   * @param {Object} job - Job with settings
   * @param {Object[]} chunks - Serialized audio chunks
   * @param {Object[]} transcriptionData - Original transcription data
   * @returns {Promise<Object[]>} New segments
   */
  async _processJobFull(recording, job, chunks, transcriptionData) {
    this.recordingStatus.textContent = 'Processing (full): initializing...';

    // Deserialize audio chunks
    const audioChunks = deserializeChunks(chunks);

    // Reset transcript merger state
    this.transcriptMerger.reset();

    // Clusterer already configured by _applyJobSettings

    // Track state for overlap merging
    let lastChunkResult = null;
    let globalTimeOffset = 0;
    const allSegments = [];

    // Process each chunk through worker
    for (let i = 0; i < audioChunks.length; i++) {
      const chunk = audioChunks[i];

      // Emit progress
      window.dispatchEvent(new CustomEvent('job-processing-progress', {
        detail: { current: i + 1, total: audioChunks.length, mode: 'full' },
      }));

      this.recordingStatus.textContent = `Processing (full): chunk ${i + 1}/${audioChunks.length}...`;

      // Send to worker and await result
      const result = await this.workerTranscribePromise(chunk.audio, i, chunk.overlapDuration, chunk.isFinal);

      if (!result || !result.data) continue;

      const { data } = result;
      const transcript = data.transcript;
      let phrases = data.phrases || [];

      // Handle overlap merging
      let wordsToUse = transcript?.chunks || [];
      let chunkStartTime = globalTimeOffset;

      if (lastChunkResult && chunk.overlapDuration > 0) {
        const prevWords = lastChunkResult.transcript?.chunks || [];
        const mergeResult = this.overlapMerger.findMergePoint(prevWords, wordsToUse, chunk.overlapDuration);

        if (mergeResult.mergeIndex > 0) {
          const mergeTimestamp = wordsToUse[mergeResult.mergeIndex]?.timestamp?.[0] || 0;
          wordsToUse = wordsToUse.slice(mergeResult.mergeIndex);
          phrases = phrases.filter(p => p.end > mergeTimestamp);
          chunkStartTime = globalTimeOffset;
          wordsToUse = this.overlapMerger.adjustTimestamps(wordsToUse, chunk.overlapDuration);
          phrases = phrases.map(p => ({
            ...p,
            start: p.start - chunk.overlapDuration,
            end: p.end - chunk.overlapDuration,
          }));
        }
      }

      // Build filtered transcript
      const filteredTranscript = {
        ...transcript,
        chunks: wordsToUse,
      };

      // Merge phrases into segments
      const mergedSegments = this.transcriptMerger.merge(filteredTranscript, phrases, chunkStartTime);
      allSegments.push(...mergedSegments);

      // Update time offset for next chunk
      if (wordsToUse.length > 0) {
        const lastWord = wordsToUse[wordsToUse.length - 1];
        const lastWordEnd = lastWord.timestamp?.[1] || lastWord.timestamp?.[0] || 0;
        globalTimeOffset = chunkStartTime + lastWordEnd;
      }

      lastChunkResult = { transcript: filteredTranscript, phrases };
    }

    return allSegments;
  }

  /**
   * Re-process all current segments through inference with updated boosting config
   * Works for both live recordings (after stopping) and saved recordings being viewed
   */
  async reprocessBoostingForCurrentSegments() {
    // Get segments from either viewed recording or live session
    let segments;
    if (this.isViewingRecording && this.viewedRecordingId) {
      // For viewed recordings, we need to get segments from the DOM-rendered state
      // They were already loaded and modified in memory during loadRecording
      segments = this._currentViewedSegments;
    } else {
      // For live session, get from transcript merger
      segments = this.transcriptMerger.getTranscript();
    }

    if (!segments || segments.length === 0) {
      return;
    }

    // Get current enrollments for inference context
    const enrollments = this.isViewingRecording
      ? (this._currentViewedEnrollments || [])
      : await EnrollmentManager.loadAll();

    // Reset inference and re-process all segments with new config
    this.conversationInference.reset();
    this.conversationInference.setEnrolledSpeakers(enrollments);
    this.conversationInference.setExpectedSpeakers(this.numSpeakers);

    // Re-process each segment through inference (keeps same clustering, new boosting)
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.debug?.clustering?.allSimilarities) {
        const { attribution } = this.conversationInference.processNewSegment(segment, i);
        segment.inferenceAttribution = attribution;
      }
    }

    // Re-render transcript with new attributions
    this.clearTranscriptDisplay();
    this.renderSegments(segments, { autoScroll: false });

    // Update participants panel
    this.updateParticipantsPanel();

    console.log(`[Boosting] Re-processed ${segments.length} segments with updated config`);
  }

  /**
   * Handle enrollment source change (snapshot vs current)
   * Re-clusters segments with the selected enrollment set
   * @param {string} source - 'snapshot' or 'current'
   */
  async handleEnrollmentSourceChange(source) {
    if (!this.isViewingRecording || !this.viewedRecordingId) return;

    try {
      // Get the recording data
      const data = await this.recordingStore.getWithChunks(this.viewedRecordingId);
      if (!data) return;

      const { recording } = data;

      // Get the appropriate enrollments
      const enrollments = source === 'snapshot'
        ? recording.enrollmentsSnapshot
        : await EnrollmentManager.loadAll();

      // Update stored enrollments for boosting re-processing
      this._currentViewedEnrollments = enrollments || [];

      // Re-cluster segments with embeddings
      const clusterer = this.transcriptMerger.speakerClusterer;

      // Reset clusterer and seed with selected enrollments
      clusterer.reset();
      if (enrollments && enrollments.length > 0) {
        clusterer.importEnrolledSpeakers(enrollments);
      }

      // Re-assign speakers to segments with embeddings
      // Pass returnDebug=true to get full clustering info for visualization
      for (const segment of recording.segments) {
        if (segment.embedding && !segment.isEnvironmental) {
          const embedding = new Float32Array(segment.embedding);
          const result = clusterer.assignSpeaker(embedding, true);

          segment.speaker = result.speakerId;
          segment.speakerLabel = clusterer.getSpeakerLabel(result.speakerId);
          segment.isEnrolledSpeaker = result.debug?.isEnrolled || false;
          segment.speakerName = clusterer.speakers[result.speakerId]?.name || null;

          // Update debug.clustering with new clustering results
          segment.debug = segment.debug || {};
          segment.debug.clustering = result.debug;

          // Clear inferenceAttribution since it's based on old clustering
          delete segment.inferenceAttribution;
        }
      }

      // Refresh inference with new enrollments
      this.conversationInference.reset();
      this.conversationInference.setEnrolledSpeakers(enrollments || []);
      this.conversationInference.setExpectedSpeakers(this.numSpeakers);

      // Process segments through inference using new clustering data
      for (let i = 0; i < recording.segments.length; i++) {
        const segment = recording.segments[i];
        if (segment.debug?.clustering?.allSimilarities) {
          const { attribution } = this.conversationInference.processNewSegment(segment, i);
          segment.inferenceAttribution = attribution;
        }
      }

      // Clear and re-render transcript using the same renderer as live recording
      this.clearTranscriptDisplay();
      this.renderSegments(recording.segments, { autoScroll: false });

      // Update participants panel
      this.updateParticipantsPanel();

      const sourceLabel = source === 'snapshot' ? 'snapshot' : 'current';
      console.log(`[Recording] Re-clustered with ${sourceLabel} enrollments`);
      this.recordingStatus.textContent = `Viewing: ${recording.name} (${sourceLabel} enrollments)`;
    } catch (error) {
      console.error('[Recording] Failed to re-cluster:', error);
    }
  }

  /**
   * Delete a saved recording
   * @param {string} recordingId
   */
  async deleteRecording(recordingId) {
    try {
      await this.recordingStore.delete(recordingId);

      // If we were viewing this recording, return to live
      if (this.viewedRecordingId === recordingId) {
        this.returnToLive();
      }

      // Update recordings list
      await this.loadRecordingsList();

      console.log(`[Recording] Deleted recording ${recordingId}`);
    } catch (error) {
      console.error('[Recording] Failed to delete:', error);
    }
  }

  /**
   * Rename a saved recording
   * @param {string} recordingId
   * @param {string} newName
   */
  async renameRecording(recordingId, newName) {
    if (!newName || !newName.trim()) return;

    try {
      await this.recordingStore.update(recordingId, { name: newName.trim() });
      await this.loadRecordingsList();

      // Update status if we're viewing this recording
      if (this.viewedRecordingId === recordingId) {
        this.recordingStatus.textContent = `Viewing: ${newName.trim()}`;
      }

      console.log(`[Recording] Renamed to "${newName.trim()}"`);
    } catch (error) {
      console.error('[Recording] Failed to rename:', error);
    }
  }

  /**
   * Download a recording as a WAV file
   * @param {string} recordingId
   */
  async downloadRecordingAsWav(recordingId) {
    try {
      this.recordingStatus.textContent = 'Preparing download...';

      // Get recording with audio chunks
      const data = await this.recordingStore.getWithChunks(recordingId);
      if (!data) {
        this.recordingStatus.textContent = 'Recording not found';
        return;
      }

      const { recording, chunks } = data;

      // Deserialize chunks to Float32Arrays
      const audioChunks = deserializeChunks(chunks);

      // Combine all chunks into a single Float32Array
      const combinedAudio = combineChunks(audioChunks);

      // Encode as WAV (16 kHz sample rate)
      const wavBlob = encodeWav(combinedAudio, 16000);

      // Generate filename from recording name
      const safeName = recording.name.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'recording';
      const filename = `${safeName}.wav`;

      // Trigger download
      downloadBlob(wavBlob, filename);

      this.recordingStatus.textContent = `Downloaded: ${filename}`;
      console.log(`[Recording] Downloaded "${filename}" (${formatFileSize(wavBlob.size)})`);
    } catch (error) {
      console.error('[Recording] Failed to download:', error);
      this.recordingStatus.textContent = 'Failed to download recording';
    }
  }

  // ==================== Worker Utility Methods ====================

  /**
   * Send batch embedding extraction request to worker
   * @param {Object[]} segments - Array of { index, audio } objects
   * @returns {Promise<Object[]>} Array of { index, embedding, error } results
   */
  batchExtractEmbeddings(segments) {
    return new Promise((resolve) => {
      this._batchEmbeddingResolver = resolve;
      this.worker.postMessage({
        type: 'batch-extract-embeddings',
        data: { segments },
      });
    });
  }

  /**
   * Send transcribe request to worker and await result
   * @param {Float32Array} audio - Audio data
   * @param {number} chunkIndex - Chunk index
   * @param {number} overlapDuration - Overlap duration in seconds
   * @param {boolean} isFinal - Is this the final chunk
   * @returns {Promise<Object>} Worker result
   */
  workerTranscribePromise(audio, chunkIndex, overlapDuration, isFinal) {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.data.type === 'result' && event.data.data?.chunkIndex === chunkIndex) {
          this.worker.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      this.worker.addEventListener('message', handler);

      this.worker.postMessage({
        type: 'transcribe',
        data: {
          audio: Array.from(audio),
          language: 'en',
          chunkIndex,
          overlapDuration,
          isFinal,
        },
      });
    });
  }

  // ==================== Enrollment Methods ====================

  /**
   * Initialize the speaker visualizer
   */
  initVisualization() {
    this.speakerVisualizer = new SpeakerVisualizer('speaker-canvas');
    this.updateVisualization();

    // Initialize participants panel
    this.participantsPanel = new ParticipantsPanel({
      listId: 'participants-list',
      statusId: 'participants-status',
    });
    this.participantsPanel.renderEmpty();

    // Set up inference callback for re-rendering changed segments
    this.conversationInference.onAttributionChange = (changedIndices) => {
      this.handleAttributionChange(changedIndices);
    };

    // Initialize inference with expected speakers
    this.conversationInference.setExpectedSpeakers(this.numSpeakers);
  }

  /**
   * Initialize resizable dividers for workspace and sidebar
   */
  initResizeDividers() {
    const workspaceDivider = document.querySelector('.workspace-divider');
    const sidebarDivider = document.getElementById('sidebar-divider');
    const rawChunksPanel = document.getElementById('raw-chunks-panel');
    const processedPanel = document.getElementById('processed-panel');
    const workspace = document.getElementById('transcript-section');
    const sidebar = document.getElementById('sidebar');

    this.resizeDividers = new ResizeDividers({
      horizontal: {
        dividerEl: workspaceDivider,
        topPanel: rawChunksPanel,
        bottomPanel: processedPanel,
        container: workspace,
      },
      vertical: {
        dividerEl: sidebarDivider,
        sidebar: sidebar,
      },
    });

    this.resizeDividers.init();

    // Restore saved sizes
    const savedSizes = {
      workspaceTopPercent: PreferencesStore.getWorkspaceTopPercent(),
      sidebarWidth: PreferencesStore.getSidebarWidth(),
    };
    this.resizeDividers.restore(savedSizes);

    // Listen for resize complete events to persist
    window.addEventListener('workspace-resize-complete', (e) => {
      PreferencesStore.setWorkspaceTopPercent(e.detail.topPercent);
    });

    window.addEventListener('sidebar-resize-complete', (e) => {
      PreferencesStore.setSidebarWidth(e.detail.width);
      // Resize and re-render the speaker visualization canvas
      if (this.speakerVisualizer) {
        this.speakerVisualizer.resize();
        this.updateVisualization();
      }
    });
  }

  /**
   * Update the speaker visualization
   */
  updateVisualization() {
    if (!this.speakerVisualizer) return;

    const speakers = this.transcriptMerger.speakerClusterer.getAllSpeakersForVisualization();
    this.speakerVisualizer.render(speakers);
  }

  /**
   * Update the speaker visualization in the speakers modal
   * @param {string} [modelId] - Optional model ID to visualize embeddings for
   */
  async updateModalVisualization(modelId = null) {
    const canvas = document.getElementById('speakers-modal-canvas');
    if (!canvas) return;

    // Create or reuse the modal visualizer
    if (!this.modalSpeakerVisualizer) {
      this.modalSpeakerVisualizer = new SpeakerVisualizer('speakers-modal-canvas');
    }

    // Resize canvas in case modal was hidden when visualizer was created
    this.modalSpeakerVisualizer.resize();

    let speakers;
    if (modelId) {
      // Fetch embeddings for specific model from enrollment store
      speakers = await enrollmentStore.getEnrollmentsForVisualization(modelId);
    } else {
      // Use current clusterer state (includes discovered speakers)
      speakers = this.transcriptMerger.speakerClusterer.getAllSpeakersForVisualization();
    }

    this.modalSpeakerVisualizer.render(speakers);
  }

  /**
   * Get all embedding models for visualization dropdown
   * Includes flag indicating if embeddings need to be computed
   * @returns {Promise<Array<{id: string, name: string, dimensions: number, hasEmbeddings: boolean, count: number, total: number}>>}
   */
  async getVisualizationModels() {
    const allModels = getAvailableEmbeddingModels();
    const enrollmentCount = await enrollmentStore.count();

    // Build list with all models and their embedding status
    const results = [];
    for (const config of allModels) {
      const enrollments = await enrollmentStore.getEnrollmentsForVisualization(config.id);
      const hasEmbeddings = enrollments.length > 0;

      results.push({
        id: config.id,
        name: config.name,
        dimensions: config.dimensions,
        hasEmbeddings,
        count: enrollments.length,
        total: enrollmentCount,
      });
    }

    return results;
  }

  /**
   * Compute embeddings for all enrollments using a specific model
   * Also computes discriminability metrics from the individual sample embeddings
   * @param {string} modelId - Model ID to compute embeddings for
   * @returns {Promise<{meanSimilarity: number|null, minSimilarity: object|null, silhouetteScore: number|null}>}
   */
  async computeEmbeddingsForModel(modelId) {
    const enrollments = await EnrollmentManager.loadAll();

    // Collect data for metrics computation
    const speakersWithSamples = [];

    for (const enrollment of enrollments) {
      // Skip if already has embedding for this model
      const existing = await enrollmentStore.getEmbeddingForModel(enrollment.id, modelId);
      if (existing) {
        // Still collect for metrics (using centroid as single sample)
        speakersWithSamples.push({
          id: enrollment.id,
          name: enrollment.name,
          centroid: existing,
          samples: [existing],
        });
        continue;
      }

      // Get audio samples
      const audioSamples = await enrollmentStore.getAudioSamples(enrollment.id);
      if (!audioSamples || audioSamples.length === 0) {
        console.warn(`[App] No audio samples for enrollment "${enrollment.name}", skipping`);
        continue;
      }

      // Compute embedding for each sample
      const sampleEmbeddings = [];
      for (const audio of audioSamples) {
        const embedding = await this.extractEmbeddingFromWorkerWithModel(audio, modelId);
        if (embedding) {
          sampleEmbeddings.push(embedding);
        }
      }

      if (sampleEmbeddings.length === 0) {
        console.warn(`[App] Failed to compute embeddings for "${enrollment.name}" with model ${modelId}`);
        continue;
      }

      // Average the embeddings to create centroid
      const dim = sampleEmbeddings[0].length;
      const avgEmbedding = new Float32Array(dim);
      for (const emb of sampleEmbeddings) {
        for (let i = 0; i < dim; i++) {
          avgEmbedding[i] += emb[i];
        }
      }
      for (let i = 0; i < dim; i++) {
        avgEmbedding[i] /= sampleEmbeddings.length;
      }

      // Store the computed centroid and sample embeddings
      await enrollmentStore.setEmbeddingForModel(enrollment.id, modelId, avgEmbedding, sampleEmbeddings);
      console.log(`[App] Computed ${modelId} embedding for "${enrollment.name}" (${sampleEmbeddings.length} samples)`);

      // Collect for metrics
      speakersWithSamples.push({
        id: enrollment.id,
        name: enrollment.name,
        centroid: avgEmbedding,
        samples: sampleEmbeddings,
      });
    }

    // Compute discriminability metrics
    const metrics = computeDiscriminabilityMetrics(speakersWithSamples);
    return metrics;
  }

  /**
   * Force recalculation of embeddings for all enrollments using a specific model
   * Unlike computeEmbeddingsForModel, this always recomputes even if embeddings exist
   * @param {string} modelId - Model ID to compute embeddings for
   * @returns {Promise<{meanSimilarity: number|null, minSimilarity: object|null, silhouetteScore: number|null}>}
   */
  async recalculateEmbeddingsForModel(modelId) {
    const enrollments = await EnrollmentManager.loadAll();
    const speakersWithSamples = [];

    for (const enrollment of enrollments) {
      // Get audio samples
      const audioSamples = await enrollmentStore.getAudioSamples(enrollment.id);
      if (!audioSamples || audioSamples.length === 0) {
        console.warn(`[App] No audio samples for enrollment "${enrollment.name}", skipping`);
        continue;
      }

      // Compute embedding for each sample
      const sampleEmbeddings = [];
      for (const audio of audioSamples) {
        const embedding = await this.extractEmbeddingFromWorkerWithModel(audio, modelId);
        if (embedding) {
          sampleEmbeddings.push(embedding);
        }
      }

      if (sampleEmbeddings.length === 0) {
        console.warn(`[App] Failed to compute embeddings for "${enrollment.name}" with model ${modelId}`);
        continue;
      }

      // Average the embeddings to create centroid
      const dim = sampleEmbeddings[0].length;
      const avgEmbedding = new Float32Array(dim);
      for (const emb of sampleEmbeddings) {
        for (let i = 0; i < dim; i++) {
          avgEmbedding[i] += emb[i];
        }
      }
      for (let i = 0; i < dim; i++) {
        avgEmbedding[i] /= sampleEmbeddings.length;
      }

      // Store the computed centroid and sample embeddings
      await enrollmentStore.setEmbeddingForModel(enrollment.id, modelId, avgEmbedding, sampleEmbeddings);
      console.log(`[App] Recalculated ${modelId} embedding for "${enrollment.name}" (${sampleEmbeddings.length} samples)`);

      // Collect for metrics
      speakersWithSamples.push({
        id: enrollment.id,
        name: enrollment.name,
        centroid: avgEmbedding,
        samples: sampleEmbeddings,
      });
    }

    // Compute discriminability metrics
    return computeDiscriminabilityMetrics(speakersWithSamples);
  }

  /**
   * Compute discriminability metrics for a model from stored embeddings
   * Uses stored sample embeddings when available for accurate silhouette score
   * @param {string} modelId - Model ID
   * @returns {Promise<{meanSimilarity: number|null, minSimilarity: object|null, silhouetteScore: number|null}>}
   */
  async computeMetricsForModel(modelId) {
    const speakers = await enrollmentStore.getEnrollmentsForVisualization(modelId);

    if (speakers.length < 2) {
      return { meanSimilarity: null, minSimilarity: null, silhouetteScore: null };
    }

    // Retrieve stored sample embeddings for each speaker
    const speakersForMetrics = await Promise.all(speakers.map(async (s) => {
      const samples = await enrollmentStore.getEmbeddingSamplesForModel(s.id, modelId);
      return {
        id: s.id,
        name: s.name,
        centroid: s.centroid,
        samples: samples || [s.centroid], // Fall back to centroid if no samples stored
      };
    }));

    return computeDiscriminabilityMetrics(speakersForMetrics);
  }

  /**
   * Extract embedding using a specific model
   * @param {Float32Array} audio - Audio samples
   * @param {string} modelId - Model ID to use
   * @returns {Promise<Float32Array|null>}
   */
  extractEmbeddingFromWorkerWithModel(audio, modelId) {
    return new Promise((resolve) => {
      const requestId = `viz-embed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const handler = (event) => {
        const { type, requestId: respId, data } = event.data;
        if (type === 'embedding-result' && respId === requestId) {
          this.worker.removeEventListener('message', handler);
          resolve(data?.embedding ? new Float32Array(data.embedding) : null);
        } else if (type === 'error' && respId === requestId) {
          this.worker.removeEventListener('message', handler);
          resolve(null);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({
        type: 'extract-embedding',
        requestId,
        data: { audio, modelId },
      });
    });
  }

  /**
   * Load saved enrollments from storage
   * Uses model-specific embeddings when available
   */
  async loadSavedEnrollments() {
    const enrollments = await EnrollmentManager.loadAll();
    if (enrollments.length > 0) {
      // Prepare enrollments with model-specific embeddings for the clusterer
      const modelId = ModelSelectionStore.getEmbeddingModel();
      const enrollmentsForClusterer = await this.prepareEnrollmentsForModel(enrollments, modelId);

      // Import all into speaker clusterer
      this.transcriptMerger.speakerClusterer.importEnrolledSpeakers(enrollmentsForClusterer);

      // Update inference with enrolled speakers
      this.conversationInference.setEnrolledSpeakers(enrollmentsForClusterer);

      // Update Alpine UI with enrolled state
      await this.dispatchEnrollmentsUpdated(enrollments);
    }
  }

  /**
   * Prepare enrollments for the current model by using model-specific embeddings.
   * For snapshot enrollments (from saved recordings), uses embedded data directly.
   * For current enrollments, can also look up fresh data from IndexedDB.
   *
   * @param {Array} enrollments - Enrollments (from snapshot or current)
   * @param {string} modelId - Model ID to get embeddings for
   * @returns {Promise<Array>} Enrollments with centroid set to model-specific embedding
   */
  async prepareEnrollmentsForModel(enrollments, modelId) {
    const results = [];
    for (const e of enrollments) {
      let embedding = null;

      // 1. First check if enrollment object has per-model embedding directly
      //    This works for both snapshot enrollments and fresh enrollments
      if (e.embeddings?.[modelId]) {
        embedding = new Float32Array(e.embeddings[modelId]);
      }

      // 2. If not found on object, try IndexedDB lookup (for fresh enrollments that might have been updated)
      if (!embedding) {
        embedding = await enrollmentStore.getEmbeddingForModel(e.id, modelId);
      }

      // 3. Fall back to legacy centroid if this is the default model
      if (!embedding && modelId === DEFAULT_EMBEDDING_MODEL && e.centroid) {
        embedding = new Float32Array(e.centroid);
      }

      if (embedding) {
        results.push({ ...e, centroid: Array.from(embedding) });
      } else {
        // No usable embedding for this model - skip this enrollment
        console.warn(`[App] Enrollment "${e.name}" has no embedding for model ${modelId}, skipping`);
      }
    }
    return results;
  }

  /**
   * Recompute embeddings for enrollments that don't have embeddings for the current model
   * Called after model finishes loading
   */
  async recomputeEnrollmentsForCurrentModel() {
    const modelId = ModelSelectionStore.getEmbeddingModel();
    const enrollmentsNeedingRecompute = await enrollmentStore.getEnrollmentsNeedingEmbeddings(modelId);

    if (enrollmentsNeedingRecompute.length === 0) {
      console.log('[App] All enrollments have embeddings for current model');
      return;
    }

    console.log(`[App] Recomputing embeddings for ${enrollmentsNeedingRecompute.length} enrollment(s) using model: ${modelId}`);

    for (const enrollment of enrollmentsNeedingRecompute) {
      const audioSamples = await enrollmentStore.getAudioSamples(enrollment.id);
      if (!audioSamples || audioSamples.length === 0) {
        console.warn(`[App] Enrollment "${enrollment.name}" has no audio samples for recomputation`);
        continue;
      }

      try {
        // Extract embeddings for each audio sample
        const embeddings = [];
        for (const audio of audioSamples) {
          const embedding = await this.extractEmbeddingFromWorker(audio);
          if (embedding) {
            embeddings.push(new Float32Array(embedding));
          }
        }

        if (embeddings.length === 0) {
          console.warn(`[App] Failed to extract any embeddings for "${enrollment.name}"`);
          continue;
        }

        // Compute average embedding (centroid)
        const dim = embeddings[0].length;
        const avgEmbedding = new Float32Array(dim);
        for (const emb of embeddings) {
          for (let i = 0; i < dim; i++) {
            avgEmbedding[i] += emb[i];
          }
        }
        for (let i = 0; i < dim; i++) {
          avgEmbedding[i] /= embeddings.length;
        }
        l2Normalize(avgEmbedding);

        // Cache the computed embedding
        await enrollmentStore.setEmbeddingForModel(enrollment.id, modelId, avgEmbedding);
        console.log(`[App] Recomputed embedding for "${enrollment.name}" (${dim}-dim)`);
      } catch (error) {
        console.error(`[App] Failed to recompute embedding for "${enrollment.name}":`, error);
      }
    }

    // Reload enrollments into clusterer with new embeddings
    await this.loadSavedEnrollments();
  }

  /**
   * Extract embedding from audio using the worker
   * @param {Float32Array} audio - Audio samples at 16kHz
   * @returns {Promise<number[]|null>} Embedding array or null on failure
   */
  extractEmbeddingFromWorker(audio) {
    return new Promise((resolve) => {
      const requestId = `recompute-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const handler = (event) => {
        const { type, requestId: respId, embedding, data } = event.data;
        if (type === 'embedding-result' && respId === requestId) {
          this.worker.removeEventListener('message', handler);
          resolve(data?.embedding || embedding || null);
        } else if (type === 'error' && respId === requestId) {
          this.worker.removeEventListener('message', handler);
          resolve(null);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({
        type: 'extract-embedding',
        requestId,
        data: { audio },
      });
    });
  }

  /**
   * Dispatch enrollments list update to Alpine
   */
  async dispatchEnrollmentsUpdated(enrollments) {
    // Fetch audio sample counts from IndexedDB for each enrollment
    const enrollmentsWithCounts = await Promise.all(
      enrollments.map(async (e, i) => {
        const sampleCount = await enrollmentStore.getAudioSampleCount(e.id);
        return {
          id: e.id,
          name: e.name,
          colorIndex: i % 6,
          sampleCount,
        };
      })
    );

    window.dispatchEvent(
      new CustomEvent('enrollments-updated', {
        detail: {
          enrollments: enrollmentsWithCounts,
        },
      })
    );
    // Update visualizations (sidebar and modal)
    this.updateVisualization();
    this.updateModalVisualization();
  }

  /**
   * Dispatch debug status update to Alpine status bar
   */
  async dispatchDebugStatusUpdate() {
    const settings = this.debugLogger.getSettings();
    const status = await this.debugLogger.getStatus();

    let statusText = 'Logging disabled';
    if (settings.enabled) {
      const parts = [];
      if (status.hasActiveSession) {
        parts.push(`${status.currentSessionLogs} logs`);
      } else {
        parts.push('Ready');
      }
      if (status.sessionCount > 0) {
        parts.push(`${status.sessionCount} session${status.sessionCount !== 1 ? 's' : ''}`);
      }
      if (settings.verbose) {
        parts.push('(verbose)');
      }
      statusText = parts.join(' • ');
    }

    window.dispatchEvent(
      new CustomEvent('debug-status-update', {
        detail: {
          enabled: settings.enabled,
          verbose: settings.verbose,
          statusText,
        },
      })
    );
  }

  /**
   * Start the enrollment process (called from Alpine via enrollment-start event)
   */
  startEnrollmentWithName(name) {
    if (!name?.trim()) {
      this.setEnrollStatus('Please enter your name first.', true);
      return;
    }

    this.enrollmentManager.reset();
    this.enrollmentManager.setName(name);

    // Open the enrollment modal
    this.openEnrollmentModal(name);
  }

  /**
   * Handle transcription validation result from worker
   */
  handleTranscriptionValidation(data) {
    this.pendingTranscriptionResult = data;
    this.checkEnrollmentResultsComplete();
  }

  /**
   * Handle embedding result from worker
   */
  handleEnrollmentEmbedding(data) {
    this.pendingEmbeddingResult = data;
    this.checkEnrollmentResultsComplete();
  }

  /**
   * Check if both transcription and embedding results are ready
   * Routes to modal handler for enrollment processing
   */
  checkEnrollmentResultsComplete() {
    // Wait for both results
    if (!this.pendingTranscriptionResult || !this.pendingEmbeddingResult) {
      return;
    }

    const transcription = this.pendingTranscriptionResult;
    const embedding = this.pendingEmbeddingResult;

    // Reset pending state
    this.pendingTranscriptionResult = null;
    this.pendingEmbeddingResult = null;

    // Route to modal handler (enrollment is done via modal)
    this.handleModalEnrollmentComplete(embedding, transcription);
  }

  /**
   * Remove a specific enrollment (called from Alpine via enrollment-remove event)
   */
  async removeEnrollment(enrollmentId) {
    // Remove from storage
    const remaining = await EnrollmentManager.removeEnrollment(enrollmentId);

    // Remove from speaker clusterer
    this.transcriptMerger.speakerClusterer.removeEnrolledSpeaker(enrollmentId);

    // Update inference with remaining enrollments
    this.conversationInference.setEnrolledSpeakers(remaining);

    // Update Alpine UI
    await this.dispatchEnrollmentsUpdated(remaining);
    this.setEnrollStatus('Speaker removed.');
  }

  /**
   * Clear all enrollments (called from Alpine via enrollment-clear-all event)
   */
  async clearAllEnrollments() {
    await EnrollmentManager.clearAll();
    this.transcriptMerger.speakerClusterer.clearAllEnrollments();
    this.enrollmentManager.reset();

    // Clear inference enrolled speakers
    this.conversationInference.setEnrolledSpeakers([]);

    // Update Alpine UI (empty list will trigger state change to 'intro')
    await this.dispatchEnrollmentsUpdated([]);
    this.setEnrollStatus('All enrollments cleared.');
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Set enrollment status message (dispatches to Alpine)
   */
  setEnrollStatus(message, isError = false) {
    window.dispatchEvent(
      new CustomEvent('enrollment-status', {
        detail: { message, isError },
      })
    );
  }

  // ==================== Enrollment Modal Methods ====================

  /**
   * Open the enrollment modal
   * @param {string} name - Speaker name for enrollment
   */
  openEnrollmentModal(name) {
    // Store last focused element for accessibility
    this.lastFocusedElement = document.activeElement;

    // Set speaker name in header
    this.modalSpeakerName.textContent = name;

    // Initialize modal progress dots
    this.initModalProgressDots();

    // Show first passage
    this.updateModalPassage();

    // Reset UI state
    this.modalRecordBtn.textContent = 'Record';
    this.modalRecordBtn.classList.remove('recording');
    this.modalFinishBtn.disabled = true;
    this.modalRecordingTimer.textContent = '0:00';
    this.modalVolumeFill.style.width = '0%';
    this.modalVadIndicator.classList.remove('speech-detected');
    this.modalVadIndicator.classList.add('listening');
    this.modalVadText.textContent = 'Listening...';
    this.setModalStatus('');

    // Show modal with animation
    this.enrollmentModal.classList.remove('hidden');

    // Focus the record button for accessibility
    setTimeout(() => {
      this.modalRecordBtn.focus();
    }, 100);
  }

  /**
   * Close the enrollment modal
   */
  closeEnrollmentModal() {
    // Stop any ongoing recording
    if (this.isEnrollmentRecording) {
      this.stopModalRecording(false); // Don't process
    }

    // Hide modal
    this.enrollmentModal.classList.add('hidden');

    // Restore focus for accessibility
    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
    }

    // Clean up VAD
    if (this.enrollmentVAD) {
      this.enrollmentVAD.destroy();
      this.enrollmentVAD = null;
    }

    // Clear timer
    if (this.enrollmentRecordingTimer) {
      clearInterval(this.enrollmentRecordingTimer);
      this.enrollmentRecordingTimer = null;
    }
  }

  /**
   * Handle keyboard events in modal
   */
  handleModalKeydown(e) {
    if (e.key === 'Escape') {
      // Don't close during recording (prevents accidental data loss)
      if (!this.isEnrollmentRecording) {
        this.cancelModalEnrollment();
      }
    } else if (e.key === 'Tab') {
      // Focus trap within modal
      this.trapFocus(e);
    }
  }

  /**
   * Trap focus within modal for accessibility
   */
  trapFocus(e) {
    const modal = this.enrollmentModal.querySelector('.modal-content');
    const focusableElements = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }

  /**
   * Initialize progress dots in modal
   */
  initModalProgressDots() {
    this.modalProgressDots.innerHTML = '';
    const total = this.enrollmentManager.getTotalSentences();

    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'progress-dot';
      dot.dataset.index = i;
      dot.textContent = i + 1; // Number inside dot

      // Click to select passage (for re-recording)
      dot.addEventListener('click', () => {
        if (!this.isEnrollmentRecording) {
          this.selectModalPassage(i);
        }
      });

      this.modalProgressDots.appendChild(dot);
    }

    this.syncModalProgressDots();
  }

  /**
   * Sync modal progress dots with recording state
   */
  syncModalProgressDots() {
    const statuses = this.enrollmentManager.getRecordingStatuses();
    const currentIndex = this.enrollmentManager.getCurrentIndex();

    statuses.forEach((status, i) => {
      const dot = this.modalProgressDots.querySelector(`[data-index="${i}"]`);
      if (dot) {
        dot.className = 'progress-dot';

        if (status === 'recorded') {
          dot.classList.add('complete');
        }

        if (i === currentIndex && !this.isEnrollmentRecording) {
          dot.classList.add('selected');
        }
      }
    });
  }

  /**
   * Select a passage in modal for recording/re-recording
   */
  selectModalPassage(index) {
    this.enrollmentManager.selectGroup(index);
    this.syncModalProgressDots();
    this.updateModalPassage();
  }

  /**
   * Update the passage text and button state in modal
   */
  updateModalPassage() {
    const currentSentence = this.enrollmentManager.getCurrentSentence();
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const hasRecording = this.enrollmentManager.hasRecording(currentIndex);

    if (currentSentence) {
      this.modalPassageText.textContent = currentSentence;
      this.modalRecordBtn.disabled = false;
      this.modalRecordBtn.textContent = hasRecording ? 'Re-record' : 'Record';
    } else {
      this.modalPassageText.textContent = 'All passages completed!';
      this.modalRecordBtn.disabled = true;
    }

    // Update finish button
    this.modalFinishBtn.disabled = !this.enrollmentManager.canComplete();
  }

  /**
   * Set modal status message
   */
  setModalStatus(message, isError = false) {
    this.modalStatus.textContent = message;
    this.modalStatus.className = 'modal-status' + (isError ? ' error' : '');
  }

  /**
   * Toggle recording in modal
   */
  toggleModalRecording() {
    if (this.isEnrollmentRecording) {
      this.stopModalRecording(true); // Process the recording
    } else {
      this.startModalRecording();
    }
  }

  /**
   * Start VAD-based recording in modal
   */
  async startModalRecording() {
    // Reset accumulated chunks
    this.enrollmentAudioChunks = [];
    this.enrollmentStartTime = Date.now();

    // Get selected microphone device ID
    const selectedDeviceId = this.micSelect.value || null;

    // Create VAD processor for enrollment (different config than main recording)
    this.enrollmentVAD = new VADProcessor({
      minSpeechDuration: 0.5, // Catch all speech (lower than main recording)
      maxSpeechDuration: 30.0, // Allow long passages
      overlapDuration: 0, // No overlap needed for enrollment
      deviceId: selectedDeviceId,
      onSpeechStart: () => this.handleEnrollmentSpeechStart(),
      onSpeechEnd: (chunk) => this.handleEnrollmentSpeechChunk(chunk),
      onSpeechProgress: (progress) => this.handleEnrollmentSpeechProgress(progress),
      onError: (error) => this.handleEnrollmentVADError(error),
      onAudioLevel: (level) => this.handleEnrollmentAudioLevel(level),
    });

    const initSuccess = await this.enrollmentVAD.init();
    if (!initSuccess) {
      this.setModalStatus('Failed to initialize VAD. Please check permissions.', true);
      return;
    }

    try {
      await this.enrollmentVAD.start();
      this.isEnrollmentRecording = true;

      // Update UI
      this.modalRecordBtn.textContent = 'Stop';
      this.modalRecordBtn.classList.add('recording');
      this.setModalStatus('Recording... Speak clearly, then click Stop.');

      // Mark current dot as recording
      const currentIndex = this.enrollmentManager.getCurrentIndex();
      const dot = this.modalProgressDots.querySelector(`[data-index="${currentIndex}"]`);
      if (dot) {
        dot.classList.add('recording');
      }

      // Start timer
      this.startRecordingTimer();
    } catch (error) {
      this.setModalStatus('Failed to start recording: ' + error.message, true);
      console.error('Failed to start enrollment VAD:', error);
    }
  }

  /**
   * Stop VAD-based recording in modal
   * @param {boolean} shouldProcess - Whether to process the accumulated audio
   */
  async stopModalRecording(shouldProcess) {
    // Stop VAD
    if (this.enrollmentVAD) {
      await this.enrollmentVAD.stop();
      await this.enrollmentVAD.destroy();
      this.enrollmentVAD = null;
    }

    this.isEnrollmentRecording = false;

    // Stop timer
    if (this.enrollmentRecordingTimer) {
      clearInterval(this.enrollmentRecordingTimer);
      this.enrollmentRecordingTimer = null;
    }

    // Reset UI
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const hasRecording = this.enrollmentManager.hasRecording(currentIndex);
    this.modalRecordBtn.textContent = hasRecording ? 'Re-record' : 'Record';
    this.modalRecordBtn.classList.remove('recording');

    // Reset VAD indicator
    this.modalVadIndicator.classList.remove('speech-detected');
    this.modalVadIndicator.classList.add('listening');
    this.modalVadText.textContent = 'Listening...';

    // Remove recording class from dot
    const dot = this.modalProgressDots.querySelector(`[data-index="${currentIndex}"]`);
    if (dot) {
      dot.classList.remove('recording');
    }

    // Process if requested
    if (shouldProcess) {
      this.processEnrollmentRecording();
    } else {
      this.syncModalProgressDots();
    }
  }

  /**
   * Handle speech start from enrollment VAD
   */
  handleEnrollmentSpeechStart() {
    this.modalVadIndicator.classList.remove('listening');
    this.modalVadIndicator.classList.add('speech-detected');
    this.modalVadText.textContent = 'Speech detected!';
  }

  /**
   * Handle speech chunk from enrollment VAD
   */
  handleEnrollmentSpeechChunk(chunk) {
    // Accumulate speech chunks
    this.enrollmentAudioChunks.push(chunk.audio);

    // Reset VAD indicator for next speech segment
    this.modalVadIndicator.classList.remove('speech-detected');
    this.modalVadIndicator.classList.add('listening');
    this.modalVadText.textContent = 'Listening...';
  }

  /**
   * Handle speech progress from enrollment VAD
   */
  handleEnrollmentSpeechProgress(progress) {
    // Keep showing "Speech detected!" while speech is ongoing
    this.modalVadIndicator.classList.remove('listening');
    this.modalVadIndicator.classList.add('speech-detected');
    this.modalVadText.textContent = `Speaking... (${progress.duration.toFixed(1)}s)`;
  }

  /**
   * Handle audio level from enrollment VAD
   */
  handleEnrollmentAudioLevel(level) {
    // Amplify for visibility (typical speech is quiet)
    const normalizedLevel = Math.min(level * 8, 1);
    this.modalVolumeFill.style.width = `${normalizedLevel * 100}%`;
  }

  /**
   * Handle VAD error during enrollment
   */
  handleEnrollmentVADError(error) {
    console.error('Enrollment VAD error:', error);
    this.setModalStatus(`VAD Error: ${error.message}`, true);
    this.stopModalRecording(false);
  }

  /**
   * Start the recording timer display
   */
  startRecordingTimer() {
    this.enrollmentRecordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.enrollmentStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      this.modalRecordingTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
  }

  /**
   * Process the accumulated enrollment recording
   */
  processEnrollmentRecording() {
    // Check if we have any audio chunks
    if (this.enrollmentAudioChunks.length === 0) {
      this.setModalStatus('No speech detected. Please try again.', true);
      this.syncModalProgressDots();
      return;
    }

    // Concatenate all speech chunks
    const totalLength = this.enrollmentAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Float32Array(totalLength);

    let offset = 0;
    for (const chunk of this.enrollmentAudioChunks) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    // Calculate total speech duration from VAD chunks
    const totalDuration = totalLength / 16000;

    // Validate using VAD-based validation
    const vadValidation = AudioValidator.validateVADSpeechContent(
      totalDuration,
      this.enrollmentAudioChunks.length
    );

    if (!vadValidation.passed) {
      this.setModalStatus(vadValidation.errors[0], true);
      this.syncModalProgressDots();
      return;
    }

    // Run audio quality checks
    const audioQuality = AudioValidator.validateAudioQuality(combinedAudio);

    if (!audioQuality.passed) {
      this.setModalStatus(audioQuality.errors[0], true);
      this.syncModalProgressDots();
      return;
    }

    // Log warnings but allow to continue
    if (audioQuality.warnings.length > 0) {
      console.warn('Audio quality warnings:', audioQuality.warnings);
    }

    // Process the audio - send to worker for embedding extraction
    this.setModalStatus('Processing...');

    this.pendingEnrollmentSampleId = this.enrollmentManager.getCurrentIndex();
    this.pendingExpectedSentence = this.enrollmentManager.getCurrentSentence();
    this.pendingEnrollmentAudio = combinedAudio; // Store for addSample
    this.pendingTranscriptionResult = null;
    this.pendingEmbeddingResult = null;

    // Request transcription for validation
    this.worker.postMessage({
      type: 'transcribe-for-validation',
      data: {
        audio: combinedAudio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });

    // Request embedding extraction
    this.worker.postMessage({
      type: 'extract-embedding',
      data: {
        audio: combinedAudio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });
  }

  /**
   * Finish enrollment from modal
   */
  async finishModalEnrollment() {
    if (!this.enrollmentManager.canComplete()) {
      this.setModalStatus('Need at least 2 recordings to complete enrollment.', true);
      return;
    }

    // Compute average embedding
    const avgEmbedding = this.enrollmentManager.computeAverageEmbedding();
    const name = this.enrollmentManager.getName();
    const rejectedCount = this.enrollmentManager.getRejectedCount();
    const audioSamples = this.enrollmentManager.getAudioSamples();

    // Save to storage (with audio samples for model switching support)
    const newEnrollment = await EnrollmentManager.addEnrollment(name, avgEmbedding, { audioSamples });

    // Import into speaker clusterer
    this.transcriptMerger.speakerClusterer.enrollSpeaker(
      name,
      avgEmbedding,
      newEnrollment.id,
      newEnrollment.colorIndex
    );

    // Check for inter-enrollment similarity warnings
    const similarityWarnings = this.transcriptMerger.speakerClusterer.checkEnrolledSpeakerSimilarities(true);

    // Close modal
    this.closeEnrollmentModal();

    // Update Alpine sidebar UI
    await this.dispatchEnrollmentsUpdated(await EnrollmentManager.loadAll());

    // Notify speakers modal that enrollment is complete
    window.dispatchEvent(new CustomEvent('enrollment-complete'));

    // Build status message
    const statusParts = [];

    if (this.enrollmentManager.hadHighOutlierRate()) {
      statusParts.push('High outlier rate - enrollment quality may be affected');
    } else if (rejectedCount > 0) {
      statusParts.push(`${rejectedCount} sample(s) excluded as outliers`);
    }

    if (similarityWarnings.length > 0) {
      const warningMsg = similarityWarnings
        .map((w) => `"${w.speaker1}" and "${w.speaker2}" sound similar`)
        .join('; ');
      statusParts.push(warningMsg);
    }

    if (statusParts.length > 0) {
      this.setEnrollStatus(`Enrolled "${name}". Note: ${statusParts.join('. ')}`);
    } else {
      this.setEnrollStatus(`Successfully enrolled "${name}".`);
    }
  }

  /**
   * Cancel enrollment from modal
   */
  async cancelModalEnrollment() {
    this.closeEnrollmentModal();
    this.enrollmentManager.reset();

    // Update Alpine sidebar UI (state determined by whether enrollments exist)
    await this.dispatchEnrollmentsUpdated(await EnrollmentManager.loadAll());
    this.setEnrollStatus('Enrollment cancelled.');
  }

  /**
   * Handle enrollment results completing (called from checkEnrollmentResultsComplete)
   * This is called after both transcription and embedding are ready
   */
  handleModalEnrollmentComplete(embedding, transcription) {
    const sampleId = this.pendingEnrollmentSampleId;

    // Check embedding extraction success
    if (!embedding.success) {
      this.setModalStatus(`Failed to process: ${embedding.error}`, true);
      this.syncModalProgressDots();
      return;
    }

    // Check transcription validation (warning only)
    let transcriptionWarning = null;
    if (transcription.success && this.pendingExpectedSentence) {
      const validation = AudioValidator.validateTranscription(
        transcription.text,
        this.pendingExpectedSentence
      );
      if (!validation.passed && validation.warnings.length > 0) {
        transcriptionWarning = validation.warnings[0];
        console.warn('Transcription validation:', transcriptionWarning);
      }
    }

    // Add sample to enrollment manager (with audio for model switching support)
    this.enrollmentManager.addSample(embedding.embedding, this.pendingEnrollmentAudio);
    this.pendingEnrollmentAudio = null; // Clear after use

    // Update modal UI
    this.syncModalProgressDots();
    this.updateModalPassage();

    // Update finish button
    this.modalFinishBtn.disabled = !this.enrollmentManager.canComplete();

    // Show status
    const sampleCount = this.enrollmentManager.getSampleCount();
    const total = this.enrollmentManager.getTotalSentences();

    if (this.enrollmentManager.isComplete()) {
      this.setModalStatus('All passages recorded! Click Finish to complete.');
    } else if (transcriptionWarning) {
      this.setModalStatus(`Recorded (${sampleCount}/${total}). Note: ${transcriptionWarning}`);
    } else {
      this.setModalStatus(`Recorded (${sampleCount}/${total}). ${total - sampleCount} remaining.`);
    }
  }

  // ==================== File Upload Methods ====================

  /**
   * Handle upload button click - trigger file input
   */
  handleUploadClick() {
    // Don't allow upload during recording
    if (this.isEnrollmentRecording) {
      return;
    }
    this.modalFileInput.click();
  }

  /**
   * Handle file selection from file input
   */
  async handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear file input so same file can be selected again
    this.modalFileInput.value = '';

    // Check file type
    if (!file.type.startsWith('audio/')) {
      this.setModalStatus('Please select an audio file.', true);
      return;
    }

    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      this.setModalStatus('File too large. Maximum size is 50MB.', true);
      return;
    }

    this.setModalStatus(`Processing "${file.name}"...`);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Decode audio
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await audioContext.close();

      // Resample to 16kHz mono
      const audio16k = await this.resampleAudio(audioBuffer, 16000);

      // Process through VAD (same as recorded audio)
      await this.processUploadedAudio(audio16k);
    } catch (error) {
      console.error('Failed to process audio file:', error);
      this.setModalStatus(`Failed to process file: ${error.message}`, true);
    }
  }

  /**
   * Resample audio to target sample rate (mono)
   * @param {AudioBuffer} audioBuffer - Input audio buffer
   * @param {number} targetSampleRate - Target sample rate (e.g., 16000)
   * @returns {Promise<Float32Array>} - Resampled mono audio
   */
  async resampleAudio(audioBuffer, targetSampleRate) {
    const numChannels = audioBuffer.numberOfChannels;
    const sourceSampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    // Calculate output length
    const outputLength = Math.ceil(duration * targetSampleRate);

    // Create offline context at target sample rate
    const offlineContext = new OfflineAudioContext(1, outputLength, targetSampleRate);

    // Create buffer source
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    // Connect to destination
    source.connect(offlineContext.destination);
    source.start(0);

    // Render
    const renderedBuffer = await offlineContext.startRendering();

    // Get mono channel data
    return renderedBuffer.getChannelData(0);
  }

  /**
   * Process uploaded audio file
   * Uses energy-based speech detection since VAD requires real-time microphone input
   * @param {Float32Array} audio - 16kHz mono audio
   */
  async processUploadedAudio(audio) {
    // Check minimum duration (0.5 seconds)
    const duration = audio.length / 16000;
    if (duration < 0.5) {
      this.setModalStatus('Audio too short. Minimum 0.5 seconds required.', true);
      return;
    }

    this.setModalStatus('Analyzing audio file...');

    // Use energy-based speech analysis (same as original enrollment validation)
    const speechAnalysis = AudioValidator.analyzeSpeechContent(audio, 16000);

    // Check for sufficient speech (at least 5 seconds)
    if (speechAnalysis.speechDuration < 5.0) {
      this.setModalStatus(
        `Not enough speech detected (${speechAnalysis.speechDuration.toFixed(1)}s). Need at least 5s of speech.`,
        true
      );
      return;
    }

    // Run audio quality checks
    const audioQuality = AudioValidator.validateAudioQuality(audio);

    if (!audioQuality.passed) {
      this.setModalStatus(audioQuality.errors[0], true);
      return;
    }

    if (audioQuality.warnings.length > 0) {
      console.warn('Audio quality warnings:', audioQuality.warnings);
    }

    // Process the audio - send to worker for embedding extraction
    this.setModalStatus('Extracting voice characteristics...');

    this.pendingEnrollmentSampleId = this.enrollmentManager.getCurrentIndex();
    this.pendingExpectedSentence = this.enrollmentManager.getCurrentSentence();
    this.pendingEnrollmentAudio = audio; // Store for addSample (was missing - causing 0 samples bug)
    this.pendingTranscriptionResult = null;
    this.pendingEmbeddingResult = null;

    // Mark current dot as processing
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const dot = this.modalProgressDots.querySelector(`[data-index="${currentIndex}"]`);
    if (dot) {
      dot.classList.add('recording');
    }

    // Request transcription for validation
    this.worker.postMessage({
      type: 'transcribe-for-validation',
      data: {
        audio: audio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });

    // Request embedding extraction
    this.worker.postMessage({
      type: 'extract-embedding',
      data: {
        audio: audio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });
  }
}
