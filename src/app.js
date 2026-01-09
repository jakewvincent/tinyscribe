/**
 * Main Application Controller
 * Coordinates audio capture, worker inference, and UI updates
 */

// Audio layer (browser audio APIs)
import { AudioCapture, VADProcessor } from './audio/index.js';

// UI components
import { SpeakerVisualizer, ParticipantsPanel, DebugPanel } from './ui/index.js';

// Debug logging
import { DebugLogger } from './utils/debugLogger.js';

// Core inference
import { ConversationInference } from './core/inference/index.js';

// Enrollment manager (still in utils/ for now)
import { EnrollmentManager } from './utils/enrollmentManager.js';

// Core modules (pure logic, no browser dependencies)
import { OverlapMerger, TranscriptMerger } from './core/transcription/index.js';
import { AudioValidator } from './core/validation/index.js';

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

    // Components
    this.worker = null;
    this.enrollmentAudioCapture = null; // Still use AudioCapture for enrollment
    this.transcriptMerger = new TranscriptMerger(this.numSpeakers);
    this.enrollmentManager = new EnrollmentManager();
    this.speakerVisualizer = null;
    this.conversationInference = new ConversationInference();
    this.participantsPanel = null;
    this.debugLogger = new DebugLogger();
    this.debugPanel = null;
    this.progressItems = new Map();
    this.panelStates = this.loadPanelStates();

    // DOM elements - Main controls
    this.loadModelsBtn = document.getElementById('load-models-btn');
    this.recordBtn = document.getElementById('record-btn');
    this.uploadBtn = document.getElementById('upload-btn');
    this.uploadFileInput = document.getElementById('upload-file-input');
    this.clearBtn = document.getElementById('clear-btn');
    this.copyBtn = document.getElementById('copy-btn');
    this.exportTranscriptBtn = document.getElementById('export-transcript-btn');
    this.exportRawBtn = document.getElementById('export-raw-btn');
    this.micSelect = document.getElementById('mic-select');
    this.numSpeakersSelect = document.getElementById('num-speakers');
    this.loadingMessage = document.getElementById('loading-message');
    this.progressContainer = document.getElementById('progress-container');
    this.deviceInfo = document.getElementById('device-info');
    this.recordingStatus = document.getElementById('recording-status');
    this.transcriptContainer = document.getElementById('transcript-container');
    this.rawChunksContainer = document.getElementById('raw-chunks-container');
    this.audioVisualizer = document.getElementById('audio-visualizer');

    // DOM elements - Enrollment
    this.enrollmentIntro = document.getElementById('enrollment-intro');
    this.enrollmentRecording = document.getElementById('enrollment-recording');
    this.enrollmentComplete = document.getElementById('enrollment-complete');
    this.enrollNameInput = document.getElementById('enroll-name');
    this.enrollStartBtn = document.getElementById('enroll-start-btn');
    this.enrollSkipBtn = document.getElementById('enroll-skip-btn');
    this.enrollSentence = document.getElementById('enroll-sentence');
    this.enrollRecordBtn = document.getElementById('enroll-record-btn');
    this.enrollProgressText = document.getElementById('enroll-progress-text');
    this.enrollDots = document.getElementById('enroll-dots');
    this.enrollFinishBtn = document.getElementById('enroll-finish-btn');
    this.enrollCancelBtn = document.getElementById('enroll-cancel-btn');
    this.enrollStatus = document.getElementById('enroll-status');

    // DOM elements - Multi-enrollment list
    this.enrolledCount = document.getElementById('enrolled-count');
    this.enrolledItems = document.getElementById('enrolled-items');
    this.addSpeakerBtn = document.getElementById('add-speaker-btn');
    this.clearAllEnrollmentsBtn = document.getElementById('clear-all-enrollments-btn');
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

    // DOM elements - Status bar
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.metricAsr = document.getElementById('metric-asr');
    this.metricEmbed = document.getElementById('metric-embed');
    this.metricTotal = document.getElementById('metric-total');
    this.bufferFill = document.getElementById('buffer-fill');
    this.bufferPercent = document.getElementById('buffer-percent');

    // DOM elements - Chunk queue (in status bar)
    this.chunkProcessing = document.getElementById('chunk-processing');
    this.chunkSlots = document.querySelectorAll('.status-chunks .chunk-slot');

    // DOM elements - Phrase stats
    this.phrasePreview = document.getElementById('phrase-preview');
    this.phraseSpeaker = document.getElementById('phrase-speaker');
    this.phraseSimilarity = document.getElementById('phrase-similarity');
    this.phraseRunnerUp = document.getElementById('phrase-runner-up');
    this.phraseMargin = document.getElementById('phrase-margin');
    this.phraseDuration = document.getElementById('phrase-duration');
    this.phraseType = document.getElementById('phrase-type');

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

    // Setup panel collapse functionality
    this.setupPanelCollapse();

    // Check for WebGPU support
    await this.detectWebGPU();

    // Migrate old single enrollment format if needed
    EnrollmentManager.migrateFromSingle();

    // Load saved enrollments
    this.loadSavedEnrollments();

    // Initialize visualization
    this.initVisualization();

    // Initialize debug logging
    await this.debugLogger.init();
    this.debugPanel = new DebugPanel({ logger: this.debugLogger });
    this.debugPanel.init();

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
      const savedDeviceId = localStorage.getItem('selected-mic-device');
      if (savedDeviceId) {
        this.micSelect.value = savedDeviceId;
      }

      // Save selection on change
      this.micSelect.addEventListener('change', () => {
        localStorage.setItem('selected-mic-device', this.micSelect.value);
      });
    } catch (error) {
      console.error('Failed to populate microphone list:', error);
    }
  }

  /**
   * Load panel collapse states from localStorage
   */
  loadPanelStates() {
    try {
      const saved = localStorage.getItem('panel-states');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }

  /**
   * Save panel collapse states to localStorage
   */
  savePanelStates() {
    try {
      localStorage.setItem('panel-states', JSON.stringify(this.panelStates));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Setup collapsible panel functionality
   */
  setupPanelCollapse() {
    const panelHeaders = document.querySelectorAll('.panel-header');

    panelHeaders.forEach((header) => {
      const panelId = header.dataset.panel;
      const panel = header.closest('.sidebar-panel');
      const content = panel.querySelector('.panel-content');
      const chevron = header.querySelector('.panel-chevron');

      if (!content || !panelId) return;

      // Get initial state from localStorage or default
      const defaultExpanded = panel.dataset.defaultExpanded === 'true';
      const isExpanded = this.panelStates[panelId] ?? defaultExpanded;

      // Apply initial state
      if (!isExpanded) {
        content.classList.add('collapsed');
        chevron.innerHTML = '&#9656;'; // Right-pointing triangle
      } else {
        content.classList.remove('collapsed');
        chevron.innerHTML = '&#9662;'; // Down-pointing triangle
      }

      // Add click handler
      header.addEventListener('click', () => {
        const nowExpanded = content.classList.toggle('collapsed');
        chevron.innerHTML = nowExpanded ? '&#9656;' : '&#9662;';
        this.panelStates[panelId] = !nowExpanded;
        this.savePanelStates();
      });
    });
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
    // Main controls
    this.loadModelsBtn.addEventListener('click', () => this.loadModels());
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.clearBtn.addEventListener('click', () => this.clearTranscript());
    this.uploadBtn.addEventListener('click', () => this.uploadFileInput.click());
    this.uploadFileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.copyBtn.addEventListener('click', () => this.copyTranscript());
    this.exportTranscriptBtn.addEventListener('click', () => this.exportTranscript());
    this.exportRawBtn.addEventListener('click', () => this.exportRawChunks());
    this.numSpeakersSelect.addEventListener('change', (e) => this.handleNumSpeakersChange(e));

    // Enrollment controls
    this.enrollStartBtn.addEventListener('click', () => this.startEnrollment());
    this.enrollSkipBtn.addEventListener('click', () => this.skipEnrollment());
    this.enrollRecordBtn.addEventListener('click', () => this.toggleEnrollmentRecording());
    this.enrollFinishBtn.addEventListener('click', () => this.finishEnrollment());
    this.enrollCancelBtn.addEventListener('click', () => this.cancelEnrollment());

    // Multi-enrollment controls
    this.addSpeakerBtn.addEventListener('click', () => this.addNewSpeaker());
    this.clearAllEnrollmentsBtn.addEventListener('click', () => this.clearAllEnrollments());

    // Enable start enrollment when name is entered
    this.enrollNameInput.addEventListener('input', () => {
      this.enrollStartBtn.disabled = !this.isModelLoaded || !this.enrollNameInput.value.trim();
    });

    // Delegate click events for remove buttons in enrolled list
    this.enrolledItems.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-enrollment')) {
        const item = e.target.closest('.enrolled-item');
        if (item && item.dataset.id) {
          this.removeEnrollment(item.dataset.id);
        }
      }
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
  }

  /**
   * Handle number of speakers change
   */
  handleNumSpeakersChange(event) {
    this.numSpeakers = parseInt(event.target.value, 10);
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
        break;

      case 'debug-log':
        this.debugLogger.log(event.data.logType, event.data.data);
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
      this.recordBtn.disabled = false;
      this.uploadBtn.disabled = false;
      this.clearBtn.disabled = false;

      // Enable enrollment buttons
      if (this.enrollNameInput.value.trim()) {
        this.enrollStartBtn.disabled = false;
      }

      // Enable add speaker button if there are enrollments and under limit
      const enrollmentCount = EnrollmentManager.getEnrollmentCount();
      if (enrollmentCount > 0 && enrollmentCount < 6) {
        this.addSpeakerBtn.disabled = false;
      }

      // Update status bar
      this.updateStatusBar('ready');

      // Auto-collapse model status panel
      this.collapsePanel('model-status');
    } else if (status === 'loading') {
      this.updateStatusBar('loading');
      // Expand model status panel during load
      this.expandPanel('model-status');
    } else if (status === 'error') {
      this.loadModelsBtn.textContent = 'Retry Loading';
      this.loadModelsBtn.disabled = false;
      this.loadModelsBtn.classList.remove('hidden');
      this.updateStatusBar('ready');
    }
  }

  /**
   * Collapse a specific panel
   */
  collapsePanel(panelId) {
    const header = document.querySelector(`[data-panel="${panelId}"]`);
    if (!header) return;

    const panel = header.closest('.sidebar-panel');
    const content = panel?.querySelector('.panel-content');
    const chevron = header.querySelector('.panel-chevron');

    if (content && !content.classList.contains('collapsed')) {
      content.classList.add('collapsed');
      chevron.innerHTML = '&#9656;';
      this.panelStates[panelId] = false;
      this.savePanelStates();
    }
  }

  /**
   * Expand a specific panel
   */
  expandPanel(panelId) {
    const header = document.querySelector(`[data-panel="${panelId}"]`);
    if (!header) return;

    const panel = header.closest('.sidebar-panel');
    const content = panel?.querySelector('.panel-content');
    const chevron = header.querySelector('.panel-chevron');

    if (content && content.classList.contains('collapsed')) {
      content.classList.remove('collapsed');
      chevron.innerHTML = '&#9662;';
      this.panelStates[panelId] = true;
      this.savePanelStates();
    }
  }

  /**
   * Handle progress updates for model downloads
   */
  handleProgress(progress) {
    const { status, file, progress: percent, loaded, total } = progress;

    if (!file) return;

    const shortName = file.split('/').pop();

    if (status === 'initiate') {
      // New file starting to download
      this.addProgressItem(file, shortName);
    } else if (status === 'progress') {
      // Update progress
      this.updateProgressItem(file, percent, loaded, total);
    } else if (status === 'done') {
      // File completed
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

  /**
   * Load models via worker
   */
  loadModels() {
    this.loadModelsBtn.disabled = true;
    this.loadModelsBtn.textContent = 'Loading...';
    this.progressContainer.innerHTML = '';
    this.progressItems.clear();

    this.worker.postMessage({
      type: 'load',
      data: { device: this.device },
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

    // Start debug logging session
    await this.debugLogger.startSession();

    // Reset UI
    this.updateChunkQueueViz();
    this.resetPhraseStats();

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
      this.recordBtn.textContent = 'Stop Recording';
      this.recordBtn.classList.add('recording');
      this.recordingStatus.textContent = 'Listening for speech...';
      this.audioVisualizer.classList.add('active');
      this.updateStatusBar('recording');
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
    this.recordBtn.textContent = 'Start Recording';
    this.recordBtn.classList.remove('recording');
    this.audioVisualizer.classList.remove('active');

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

        // Update phrase stats with last segment
        const lastSegment = mergedSegments[mergedSegments.length - 1];
        this.updatePhraseStats(lastSegment);
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
   */
  renderSegments(segments) {
    // Remove placeholder if present
    const placeholder = this.transcriptContainer.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    for (const segment of segments) {
      const segmentEl = document.createElement('div');
      const labelEl = document.createElement('div');
      const textEl = document.createElement('div');
      textEl.className = 'segment-text';
      textEl.textContent = segment.text;

      // Get inference display info if available
      const inference = segment.inferenceAttribution;
      const displayInfo = inference?.displayInfo;

      // Build confidence metrics HTML if available
      let confidenceHtml = '';
      if (segment.debug?.clustering && !segment.isEnvironmental) {
        const clustering = segment.debug.clustering;
        const sim = clustering.similarity?.toFixed(2) || '-';
        const margin = clustering.margin?.toFixed(2) || '-';

        // Determine confidence class
        let marginClass = '';
        if (clustering.margin >= 0.15) {
          marginClass = 'confidence-high';
        } else if (clustering.margin >= 0.05) {
          marginClass = 'confidence-medium';
        } else if (clustering.margin > 0) {
          marginClass = 'confidence-low';
        }

        confidenceHtml = `
          <div class="segment-confidence">
            <span class="conf-item" title="Similarity to assigned speaker">sim: ${sim}</span>
            <span class="conf-item ${marginClass}" title="Margin between best and second-best match">margin: ${margin}</span>
          </div>
        `;
      }

      // Build alternate speaker HTML if inference suggests ambiguity
      let alternateHtml = '';
      if (displayInfo?.showAlternate && displayInfo?.alternateLabel) {
        alternateHtml = ` <span class="alternate-speaker">(${displayInfo.alternateLabel}?)</span>`;
      }

      // Build boost indicator if attribution was influenced
      let boostHtml = '';
      if (displayInfo?.wasInfluenced) {
        boostHtml = '<span class="boost-indicator" title="Boosted by conversation context"></span>';
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
        segmentEl.className = 'transcript-segment unknown-speaker';
        labelEl.className = 'speaker-label unknown-speaker';

        // Use inference label if available (might show alternate)
        const label = displayInfo?.label || segment.speakerLabel || 'Unknown';
        labelEl.innerHTML = `
          ${label}${alternateHtml}${boostHtml}
          <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
          ${confidenceHtml}
        `;
      } else {
        // Regular speaker segment
        const speakerClass = `speaker-${segment.speaker % 6}`;
        segmentEl.className = `transcript-segment ${speakerClass}`;
        labelEl.className = `speaker-label ${speakerClass}`;

        // Use inference label if available
        const label = displayInfo?.label || segment.speakerLabel;
        labelEl.innerHTML = `
          ${label}${alternateHtml}${boostHtml}
          <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
          ${confidenceHtml}
        `;
      }

      segmentEl.appendChild(labelEl);
      segmentEl.appendChild(textEl);
      this.transcriptContainer.appendChild(segmentEl);
    }

    // Auto-scroll to bottom
    this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;

    // Enable copy/export buttons
    if (segments.length > 0) {
      this.copyBtn.disabled = false;
      this.exportTranscriptBtn.disabled = false;
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

    // Update buffer bar in status bar
    this.bufferFillPercent = Math.round(normalizedLevel * 100);
    if (this.bufferFill) {
      this.bufferFill.style.width = `${this.bufferFillPercent}%`;
    }
    if (this.bufferPercent) {
      this.bufferPercent.textContent = `${this.bufferFillPercent}%`;
    }
  }

  /**
   * Update status bar state
   */
  updateStatusBar(state) {
    if (!this.statusDot || !this.statusText) return;

    // Remove all state classes
    this.statusDot.classList.remove('ready', 'recording', 'processing', 'loading');

    switch (state) {
      case 'ready':
        this.statusDot.classList.add('ready');
        this.statusText.textContent = 'Ready';
        break;
      case 'recording':
        this.statusDot.classList.add('recording');
        this.statusText.textContent = 'Recording';
        break;
      case 'processing':
        this.statusDot.classList.add('processing');
        this.statusText.textContent = 'Processing';
        break;
      case 'loading':
        this.statusDot.classList.add('loading');
        this.statusText.textContent = 'Loading models...';
        break;
    }
  }

  /**
   * Update status bar metrics with timing data
   */
  updateStatusBarMetrics(debug, totalTime) {
    if (this.metricAsr) {
      this.metricAsr.textContent = `${debug.asrTime}ms`;
    }
    if (this.metricEmbed) {
      // Combine feature extraction and embedding time
      const embedTime = debug.featureTime + (debug.embeddingTime || 0);
      this.metricEmbed.textContent = `${embedTime}ms`;
    }
    if (this.metricTotal) {
      this.metricTotal.textContent = `${Math.round(totalTime)}ms`;
    }
  }

  /**
   * Update chunk queue visualization in status bar
   * Shows current processing activity with compact display
   */
  updateChunkQueueViz() {
    if (!this.chunkSlots || !this.chunkProcessing) return;

    const pendingCount = this.pendingChunks.size;
    const queuedCount = this.chunkQueue.length;
    const isActive = this.isRecording || this.isProcessingChunk || pendingCount > 0 || queuedCount > 0;

    // Update processing text (compact for status bar)
    if (this.isProcessingChunk) {
      this.chunkProcessing.textContent = `#${this.completedChunks + 1} processing`;
    } else if (pendingCount > 0 || queuedCount > 0) {
      this.chunkProcessing.textContent = `${queuedCount} queued`;
    } else if (this.isRecording) {
      this.chunkProcessing.textContent = 'Listening...';
    } else if (this.completedChunks > 0) {
      this.chunkProcessing.textContent = `${this.completedChunks} done`;
    } else {
      this.chunkProcessing.textContent = 'Idle';
    }

    // Update slot visuals - show current activity only
    this.chunkSlots.forEach((slot, i) => {
      slot.className = 'chunk-slot';

      if (!isActive) {
        // Idle - all slots empty
        return;
      }

      // Slot 0: currently processing (if any)
      // Slots 1-4: queued chunks
      if (i === 0 && this.isProcessingChunk) {
        slot.classList.add('processing');
      } else if (i > 0 && i <= queuedCount) {
        slot.classList.add('queued');
      }
      // else: empty slot
    });
  }

  /**
   * Update phrase stats panel
   */
  updatePhraseStats(segment) {
    if (!segment) return;

    // Update phrase preview
    if (this.phrasePreview) {
      const text = segment.text || '';
      this.phrasePreview.textContent = text.length > 80 ? text.substring(0, 80) + '...' : text;
    }

    // Update speaker
    if (this.phraseSpeaker) {
      if (segment.isEnvironmental) {
        this.phraseSpeaker.textContent = 'Environmental';
      } else {
        this.phraseSpeaker.textContent = segment.speakerLabel || '-';
      }
    }

    // Update debug info if available
    const debug = segment.debug;
    if (debug && debug.clustering) {
      const clustering = debug.clustering;

      // Similarity
      if (this.phraseSimilarity) {
        const sim = clustering.similarity?.toFixed(2) || '-';
        this.phraseSimilarity.textContent = sim;
      }

      // Runner-up
      if (this.phraseRunnerUp) {
        const secondBest = clustering.secondBestSimilarity?.toFixed(2) || '-';
        const secondSpeaker = clustering.secondBestSpeaker || '';
        this.phraseRunnerUp.textContent = secondSpeaker ? `${secondBest} (${secondSpeaker})` : secondBest;
      }

      // Margin with confidence indicator
      if (this.phraseMargin) {
        const margin = clustering.margin?.toFixed(2) || '-';
        let confidenceClass = '';
        let indicator = '';

        if (clustering.margin >= 0.15) {
          confidenceClass = 'confidence-high';
          indicator = ' ✓';
        } else if (clustering.margin >= 0.05) {
          confidenceClass = 'confidence-medium';
          indicator = ' ~';
        } else if (clustering.margin > 0) {
          confidenceClass = 'confidence-low';
          indicator = ' !';
        }

        this.phraseMargin.textContent = margin + indicator;
        this.phraseMargin.className = `detail-value ${confidenceClass}`;
      }
    } else {
      // No clustering data
      if (this.phraseSimilarity) this.phraseSimilarity.textContent = '-';
      if (this.phraseRunnerUp) this.phraseRunnerUp.textContent = '-';
      if (this.phraseMargin) {
        this.phraseMargin.textContent = '-';
        this.phraseMargin.className = 'detail-value';
      }
    }

    // Duration
    if (this.phraseDuration && debug) {
      const duration = debug.duration?.toFixed(1) || '-';
      const frames = debug.frameCount || 0;
      this.phraseDuration.textContent = `${duration}s (${frames} frames)`;
    }

    // Type
    if (this.phraseType && debug) {
      this.phraseType.textContent = debug.type || 'speech';
    }
  }

  /**
   * Reset phrase stats panel to initial state
   */
  resetPhraseStats() {
    if (this.phrasePreview) this.phrasePreview.textContent = 'No phrases yet';
    if (this.phraseSpeaker) this.phraseSpeaker.textContent = '-';
    if (this.phraseSimilarity) this.phraseSimilarity.textContent = '-';
    if (this.phraseRunnerUp) this.phraseRunnerUp.textContent = '-';
    if (this.phraseMargin) {
      this.phraseMargin.textContent = '-';
      this.phraseMargin.className = 'detail-value';
    }
    if (this.phraseDuration) this.phraseDuration.textContent = '-';
    if (this.phraseType) this.phraseType.textContent = '-';
  }

  /**
   * Clear transcript display only
   */
  clearTranscriptDisplay() {
    this.transcriptContainer.innerHTML =
      '<p class="placeholder">Transcript will appear here when you start recording...</p>';
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
    this.copyBtn.disabled = true;
    this.exportTranscriptBtn.disabled = true;

    // Reset participants panel
    if (this.participantsPanel) {
      this.participantsPanel.reset();
    }
  }

  /**
   * Copy transcript to clipboard
   */
  async copyTranscript() {
    const text = this.transcriptMerger.exportAsText();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const originalText = this.copyBtn.textContent;
      this.copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyBtn.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  /**
   * Export processed transcript as JSON file with speaker attribution metadata
   */
  exportTranscript() {
    const segments = this.transcriptMerger.getTranscript();
    if (segments.length === 0) return;

    const exportData = {
      exportedAt: new Date().toISOString(),
      segmentCount: segments.length,
      speakers: this.transcriptMerger.getSpeakers(),
      segments: segments.map((seg) => ({
        text: seg.text.trim(),
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
              allSimilarities: seg.debug.clustering.allSimilarities,
            }
          : null,
        debug: {
          duration: seg.debug?.duration,
          frameCount: seg.debug?.frameCount,
          type: seg.debug?.type,
        },
      })),
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Brief feedback
    const originalText = this.exportTranscriptBtn.textContent;
    this.exportTranscriptBtn.textContent = 'Exported!';
    setTimeout(() => {
      this.exportTranscriptBtn.textContent = originalText;
    }, 2000);
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
  updateParticipantsPanel() {
    if (!this.participantsPanel) return;

    const hypothesis = this.conversationInference.getHypothesis();
    const enrollments = EnrollmentManager.loadAll();
    this.participantsPanel.render(hypothesis, enrollments);
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
   * Update the speaker visualization
   */
  updateVisualization() {
    if (!this.speakerVisualizer) return;

    const speakers = this.transcriptMerger.speakerClusterer.getAllSpeakersForVisualization();
    this.speakerVisualizer.render(speakers);
  }

  /**
   * Load saved enrollments from localStorage
   */
  loadSavedEnrollments() {
    const enrollments = EnrollmentManager.loadAll();
    if (enrollments.length > 0) {
      // Import all into speaker clusterer
      this.transcriptMerger.speakerClusterer.importEnrolledSpeakers(enrollments);

      // Update inference with enrolled speakers
      this.conversationInference.setEnrolledSpeakers(enrollments);

      // Update UI to show enrolled state
      this.renderEnrolledList(enrollments);
      this.showEnrollmentComplete();
    }
  }

  /**
   * Start the enrollment process
   */
  startEnrollment() {
    const name = this.enrollNameInput.value.trim();
    if (!name) {
      this.setEnrollStatus('Please enter your name first.', true);
      return;
    }

    this.enrollmentManager.reset();
    this.enrollmentManager.setName(name);

    // Open the enrollment modal instead of sidebar UI
    this.openEnrollmentModal(name);
  }

  /**
   * Skip enrollment entirely
   */
  skipEnrollment() {
    this.enrollmentIntro.classList.add('hidden');
    this.enrollmentRecording.classList.add('hidden');
    this.enrollmentComplete.classList.add('hidden');
    this.setEnrollStatus('Enrollment skipped. Using automatic speaker detection.');
  }

  /**
   * Toggle enrollment recording (start/stop)
   */
  async toggleEnrollmentRecording() {
    if (this.isEnrolling) {
      this.stopEnrollmentRecording();
    } else {
      await this.startEnrollmentRecording();
    }
  }

  /**
   * Start recording for enrollment sample
   */
  async startEnrollmentRecording() {
    this.enrollmentAudioCapture = new AudioCapture({
      chunkDuration: 30, // Long duration - we'll stop manually
      overlapDuration: 0,
      onChunkReady: (chunk) => this.handleEnrollmentChunk(chunk),
      onError: (error) => this.handleEnrollmentError(error),
    });

    const success = await this.enrollmentAudioCapture.start();

    if (success) {
      this.isEnrolling = true;
      this.isEnrollmentRecording = true;
      this.enrollRecordBtn.textContent = 'Stop';
      this.enrollRecordBtn.classList.add('recording');
      this.setEnrollStatus('Recording... Read the passage aloud, then click Stop.');

      // Mark current dot as recording
      this.updateCurrentDot('recording');
    } else {
      this.setEnrollStatus('Failed to access microphone.', true);
    }
  }

  /**
   * Stop enrollment recording and process
   */
  stopEnrollmentRecording() {
    if (this.enrollmentAudioCapture) {
      // Force emit current audio
      this.enrollmentAudioCapture.stop();
      this.enrollmentAudioCapture = null;
    }

    this.isEnrolling = false;
    this.isEnrollmentRecording = false;

    // Update button text based on current passage recording status
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const hasRecording = this.enrollmentManager.hasRecording(currentIndex);
    this.enrollRecordBtn.textContent = hasRecording ? 'Re-record' : 'Record';
    this.enrollRecordBtn.classList.remove('recording');

    // Sync dots to remove recording state
    this.syncEnrollmentDots();
  }

  /**
   * Handle recorded enrollment audio chunk
   * Validates audio quality and speech content before processing
   */
  handleEnrollmentChunk(chunk) {
    // Check if we have enough audio (at least 1 second)
    if (chunk.audio.length < 16000) {
      this.setEnrollStatus('Recording too short. Please try again.', true);
      this.updateCurrentDot('');
      return;
    }

    // Phase 1: Audio quality checks (synchronous, fast)
    const audioQuality = AudioValidator.validateAudioQuality(chunk.audio);

    if (!audioQuality.passed) {
      this.setEnrollStatus(audioQuality.errors[0], true);
      this.updateCurrentDot('');
      return;
    }

    // Log warnings but allow to continue
    if (audioQuality.warnings.length > 0) {
      console.warn('Audio quality warnings:', audioQuality.warnings);
    }

    // Phase 2: Speech content analysis (synchronous, fast)
    const speechAnalysis = AudioValidator.analyzeSpeechContent(chunk.audio);
    const speechValidation = AudioValidator.validateSpeechContent(speechAnalysis);

    if (!speechValidation.passed) {
      this.setEnrollStatus(speechValidation.errors[0], true);
      this.updateCurrentDot('');
      return;
    }

    // Phase 3: Send both transcription and embedding requests in parallel
    this.setEnrollStatus('Processing...');
    this.pendingEnrollmentSampleId = this.enrollmentManager.getCurrentIndex();
    this.pendingExpectedSentence = this.enrollmentManager.getCurrentSentence();
    this.pendingTranscriptionResult = null;
    this.pendingEmbeddingResult = null;

    // Request transcription for validation
    this.worker.postMessage({
      type: 'transcribe-for-validation',
      data: {
        audio: chunk.audio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });

    // Request embedding extraction
    this.worker.postMessage({
      type: 'extract-embedding',
      data: {
        audio: chunk.audio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });
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
   * If so, validate and complete the enrollment sample
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

    // Check if modal is open - route to modal handler
    const isModalOpen = !this.enrollmentModal.classList.contains('hidden');
    if (isModalOpen) {
      this.handleModalEnrollmentComplete(embedding, transcription);
      return;
    }

    // Legacy sidebar flow (kept for backwards compatibility)
    // Check embedding extraction success
    if (!embedding.success) {
      this.setEnrollStatus(`Failed to process: ${embedding.error}`, true);
      this.updateCurrentDot('');
      return;
    }

    // Check transcription validation (warning only, doesn't block)
    let transcriptionWarning = null;
    if (transcription.success && this.pendingExpectedSentence) {
      const validation = AudioValidator.validateTranscription(
        transcription.text,
        this.pendingExpectedSentence
      );
      if (!validation.passed && validation.warnings.length > 0) {
        transcriptionWarning = validation.warnings[0];
        console.warn('Transcription validation:', transcriptionWarning, `(${(validation.matchRatio * 100).toFixed(0)}% match)`);
      }
    }

    // Add sample to enrollment manager (auto-advances to next empty slot)
    this.enrollmentManager.addSample(embedding.embedding);

    // Update UI
    this.syncEnrollmentDots();
    this.updateEnrollmentUI();

    // Check if we can finish
    this.enrollFinishBtn.disabled = !this.enrollmentManager.canComplete();

    // Show status with optional transcription warning
    const sampleCount = this.enrollmentManager.getSampleCount();
    const total = this.enrollmentManager.getTotalSentences();

    if (this.enrollmentManager.isComplete()) {
      this.setEnrollStatus('All passages recorded! Click Finish to complete enrollment.');
    } else if (transcriptionWarning) {
      this.setEnrollStatus(`Recorded (${sampleCount}/${total}). Note: ${transcriptionWarning}`);
    } else {
      this.setEnrollStatus(`Recorded (${sampleCount}/${total}). ${total - sampleCount} passage${total - sampleCount === 1 ? '' : 's'} remaining.`);
    }
  }

  /**
   * Finish enrollment and save
   */
  finishEnrollment() {
    if (!this.enrollmentManager.canComplete()) {
      this.setEnrollStatus('Need at least 3 samples to complete enrollment.', true);
      return;
    }

    // Compute average embedding (includes outlier rejection)
    const avgEmbedding = this.enrollmentManager.computeAverageEmbedding();
    const name = this.enrollmentManager.getName();
    const rejectedCount = this.enrollmentManager.getRejectedCount();

    // Save to localStorage and get the created enrollment
    const newEnrollment = EnrollmentManager.addEnrollment(name, avgEmbedding);

    // Import into speaker clusterer
    this.transcriptMerger.speakerClusterer.enrollSpeaker(
      name,
      avgEmbedding,
      newEnrollment.id,
      newEnrollment.colorIndex
    );

    // Check for inter-enrollment similarity warnings
    const similarityWarnings = this.transcriptMerger.speakerClusterer.checkEnrolledSpeakerSimilarities(true);

    // Update inference with new enrollments
    this.conversationInference.setEnrolledSpeakers(EnrollmentManager.loadAll());

    // Update UI
    this.renderEnrolledList(EnrollmentManager.loadAll());
    this.showEnrollmentComplete();
    this.updateVisualization();

    // Build status message with any warnings
    const statusParts = [];

    if (this.enrollmentManager.hadHighOutlierRate()) {
      statusParts.push(`High outlier rate detected - enrollment quality may be affected`);
    } else if (rejectedCount > 0) {
      statusParts.push(`${rejectedCount} sample(s) excluded as outliers`);
    }

    if (similarityWarnings.length > 0) {
      const warningMsg = similarityWarnings.map(w =>
        `"${w.speaker1}" and "${w.speaker2}" sound similar (${(w.similarity * 100).toFixed(0)}%)`
      ).join('; ');
      statusParts.push(warningMsg + ' - they may be confused during transcription');
    }

    if (statusParts.length > 0) {
      this.setEnrollStatus(`Enrollment complete. Note: ${statusParts.join('. ')}`);
    } else {
      this.setEnrollStatus('');
    }
  }

  /**
   * Cancel enrollment in progress
   */
  cancelEnrollment() {
    this.stopEnrollmentRecording();
    this.enrollmentManager.reset();

    this.enrollmentRecording.classList.add('hidden');

    // Go back to either intro or complete state
    const enrollments = EnrollmentManager.loadAll();
    if (enrollments.length > 0) {
      this.showEnrollmentComplete();
    } else {
      this.enrollmentIntro.classList.remove('hidden');
    }
    this.setEnrollStatus('Enrollment cancelled.');
  }

  /**
   * Add a new speaker (starts enrollment for additional speaker)
   */
  addNewSpeaker() {
    // Check limit
    if (EnrollmentManager.getEnrollmentCount() >= 6) {
      this.setEnrollStatus('Maximum of 6 speakers reached.', true);
      return;
    }

    // Show intro state for new enrollment
    this.enrollmentComplete.classList.add('hidden');
    this.enrollmentIntro.classList.remove('hidden');
    this.enrollNameInput.value = '';
    this.enrollStartBtn.disabled = !this.isModelLoaded;
    this.setEnrollStatus('');
  }

  /**
   * Remove a specific enrollment
   */
  removeEnrollment(enrollmentId) {
    // Remove from localStorage
    const remaining = EnrollmentManager.removeEnrollment(enrollmentId);

    // Remove from speaker clusterer
    this.transcriptMerger.speakerClusterer.removeEnrolledSpeaker(enrollmentId);

    // Update inference with remaining enrollments
    this.conversationInference.setEnrolledSpeakers(remaining);

    // Update UI
    if (remaining.length > 0) {
      this.renderEnrolledList(remaining);
      this.updateVisualization();
    } else {
      this.enrollmentComplete.classList.add('hidden');
      this.enrollmentIntro.classList.remove('hidden');
      this.addSpeakerBtn.disabled = true;
      this.updateVisualization();
    }
    this.setEnrollStatus('Speaker removed.');
  }

  /**
   * Clear all enrollments
   */
  clearAllEnrollments() {
    EnrollmentManager.clearAll();
    this.transcriptMerger.speakerClusterer.clearAllEnrollments();
    this.enrollmentManager.reset();

    // Clear inference enrolled speakers
    this.conversationInference.setEnrolledSpeakers([]);

    this.enrollmentComplete.classList.add('hidden');
    this.enrollmentIntro.classList.remove('hidden');
    this.enrollNameInput.value = '';
    this.enrollStartBtn.disabled = !this.isModelLoaded;
    this.addSpeakerBtn.disabled = true;
    this.updateVisualization();
    this.setEnrollStatus('All enrollments cleared.');
  }

  /**
   * Handle enrollment recording error
   */
  handleEnrollmentError(error) {
    console.error('Enrollment error:', error);
    this.setEnrollStatus(`Error: ${error.message}`, true);
    this.stopEnrollmentRecording();
  }

  /**
   * Show enrollment complete state (enrolled speakers list)
   */
  showEnrollmentComplete() {
    this.enrollmentIntro.classList.add('hidden');
    this.enrollmentRecording.classList.add('hidden');
    this.enrollmentComplete.classList.remove('hidden');

    // Update add speaker button state
    const count = EnrollmentManager.getEnrollmentCount();
    this.addSpeakerBtn.disabled = !this.isModelLoaded || count >= 6;
  }

  /**
   * Render the list of enrolled speakers
   */
  renderEnrolledList(enrollments) {
    const speakerColors = [
      'var(--speaker-0)',
      'var(--speaker-1)',
      'var(--speaker-2)',
      'var(--speaker-3)',
      'var(--speaker-4)',
      'var(--speaker-5)',
    ];

    // Update count
    const count = enrollments.length;
    this.enrolledCount.textContent = `${count} speaker${count !== 1 ? 's' : ''} enrolled`;

    // Clear existing items
    this.enrolledItems.innerHTML = '';

    // Render each enrollment
    for (const enrollment of enrollments) {
      const item = document.createElement('div');
      item.className = 'enrolled-item';
      item.dataset.id = enrollment.id;

      const colorIndex = enrollment.colorIndex ?? 0;
      item.innerHTML = `
        <span class="speaker-dot" style="background: ${speakerColors[colorIndex % 6]}"></span>
        <span class="enrolled-name">${this.escapeHtml(enrollment.name)}</span>
        <button class="btn-icon remove-enrollment" title="Remove">&times;</button>
      `;

      this.enrolledItems.appendChild(item);
    }

    // Update add speaker button
    this.addSpeakerBtn.disabled = !this.isModelLoaded || count >= 6;
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
   * Update enrollment UI for current state
   */
  updateEnrollmentUI() {
    const currentSentence = this.enrollmentManager.getCurrentSentence();
    const sampleCount = this.enrollmentManager.getSampleCount();
    const total = this.enrollmentManager.getTotalSentences();
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const hasRecording = this.enrollmentManager.hasRecording(currentIndex);

    if (currentSentence) {
      this.enrollSentence.textContent = currentSentence;
      this.enrollRecordBtn.disabled = false;
      // Update button text based on whether this passage was already recorded
      this.enrollRecordBtn.textContent = hasRecording ? 'Re-record' : 'Record';
    } else {
      this.enrollSentence.textContent = 'All passages completed!';
      this.enrollRecordBtn.disabled = true;
    }

    // Show sample count and which passage is selected
    const passageLabel = hasRecording ? `Passage ${currentIndex + 1} (recorded)` : `Passage ${currentIndex + 1}`;
    this.enrollProgressText.textContent = `${sampleCount} of ${total} recorded | ${passageLabel}`;
    this.enrollFinishBtn.disabled = !this.enrollmentManager.canComplete();
  }

  /**
   * Initialize progress dots for enrollment with click handlers
   */
  initEnrollmentDots() {
    this.enrollDots.innerHTML = '';
    const total = this.enrollmentManager.getTotalSentences();
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'progress-dot';
      dot.dataset.index = i;
      dot.addEventListener('click', () => this.selectEnrollmentPassage(i));
      this.enrollDots.appendChild(dot);
    }
    this.syncEnrollmentDots();
  }

  /**
   * Select a specific passage for recording/re-recording
   */
  selectEnrollmentPassage(index) {
    // Don't allow selection while recording
    if (this.isEnrollmentRecording) return;

    this.enrollmentManager.selectGroup(index);
    this.syncEnrollmentDots();
    this.updateEnrollmentUI();
  }

  /**
   * Sync all dots with recording statuses from enrollment manager
   */
  syncEnrollmentDots() {
    const statuses = this.enrollmentManager.getRecordingStatuses();
    const currentIndex = this.enrollmentManager.getCurrentIndex();

    statuses.forEach((status, i) => {
      const dot = this.enrollDots.querySelector(`[data-index="${i}"]`);
      if (dot) {
        // Base class
        let className = 'progress-dot';

        // Add complete class if recorded
        if (status === 'recorded') {
          className += ' complete';
        }

        // Add selected class for current selection (not during recording)
        if (i === currentIndex && !this.isEnrollmentRecording) {
          className += ' selected';
        }

        dot.className = className;
      }
    });
  }

  /**
   * Update current dot to show recording state
   * @param {string} state - 'recording' or '' (empty to reset)
   */
  updateCurrentDot(state) {
    if (state === 'recording') {
      // Add recording class to current dot
      const currentIndex = this.enrollmentManager.getCurrentIndex();
      const dot = this.enrollDots.querySelector(`[data-index="${currentIndex}"]`);
      if (dot) {
        dot.classList.add('recording');
      }
    } else {
      // Sync all dots to reset state
      this.syncEnrollmentDots();
    }
  }

  /**
   * Set enrollment status message
   */
  setEnrollStatus(message, isError = false) {
    this.enrollStatus.textContent = message;
    this.enrollStatus.className = isError ? 'error' : '';
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
  finishModalEnrollment() {
    if (!this.enrollmentManager.canComplete()) {
      this.setModalStatus('Need at least 2 recordings to complete enrollment.', true);
      return;
    }

    // Compute average embedding
    const avgEmbedding = this.enrollmentManager.computeAverageEmbedding();
    const name = this.enrollmentManager.getName();
    const rejectedCount = this.enrollmentManager.getRejectedCount();

    // Save to localStorage
    const newEnrollment = EnrollmentManager.addEnrollment(name, avgEmbedding);

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

    // Update sidebar UI
    this.renderEnrolledList(EnrollmentManager.loadAll());
    this.showEnrollmentComplete();
    this.updateVisualization();

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
  cancelModalEnrollment() {
    this.closeEnrollmentModal();
    this.enrollmentManager.reset();

    // Return to appropriate sidebar state
    const enrollments = EnrollmentManager.loadAll();
    if (enrollments.length > 0) {
      this.showEnrollmentComplete();
    } else {
      this.enrollmentIntro.classList.remove('hidden');
    }

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

    // Add sample to enrollment manager
    this.enrollmentManager.addSample(embedding.embedding);

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
