/**
 * Main Application Controller
 * Coordinates audio capture, worker inference, and UI updates
 */

import { AudioCapture } from './utils/audioCapture.js';
import { VADProcessor } from './utils/vadProcessor.js';
import { OverlapMerger } from './utils/overlapMerger.js';
import { TranscriptMerger } from './utils/transcriptMerger.js';
import { EnrollmentManager } from './utils/enrollmentManager.js';
import { SpeakerVisualizer } from './utils/speakerVisualizer.js';

export class App {
  constructor() {
    // State
    this.isModelLoaded = false;
    this.isRecording = false;
    this.isEnrolling = false;
    this.device = 'wasm';
    this.numSpeakers = 2;
    this.pendingChunks = new Map();
    this.pendingEnrollmentSampleId = null;

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

    // Components
    this.worker = null;
    this.enrollmentAudioCapture = null; // Still use AudioCapture for enrollment
    this.transcriptMerger = new TranscriptMerger(this.numSpeakers);
    this.enrollmentManager = new EnrollmentManager();
    this.speakerVisualizer = null;
    this.progressItems = new Map();
    this.panelStates = this.loadPanelStates();

    // DOM elements - Main controls
    this.loadModelsBtn = document.getElementById('load-models-btn');
    this.recordBtn = document.getElementById('record-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.copyBtn = document.getElementById('copy-btn');
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
    this.enrollSkipSentenceBtn = document.getElementById('enroll-skip-sentence-btn');
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

    // DOM elements - Status bar
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.metricAsr = document.getElementById('metric-asr');
    this.metricEmbed = document.getElementById('metric-embed');
    this.metricTotal = document.getElementById('metric-total');
    this.bufferFill = document.getElementById('buffer-fill');
    this.bufferPercent = document.getElementById('buffer-percent');

    // DOM elements - Chunk queue
    this.chunkProcessing = document.getElementById('chunk-processing');
    this.chunkCounts = document.getElementById('chunk-counts');
    this.chunkSlots = document.querySelectorAll('.chunk-slot');

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
    this.copyBtn.addEventListener('click', () => this.copyTranscript());
    this.numSpeakersSelect.addEventListener('change', (e) => this.handleNumSpeakersChange(e));

    // Enrollment controls
    this.enrollStartBtn.addEventListener('click', () => this.startEnrollment());
    this.enrollSkipBtn.addEventListener('click', () => this.skipEnrollment());
    this.enrollRecordBtn.addEventListener('click', () => this.toggleEnrollmentRecording());
    this.enrollSkipSentenceBtn.addEventListener('click', () => this.skipEnrollmentSentence());
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
  }

  /**
   * Handle number of speakers change
   */
  handleNumSpeakersChange(event) {
    this.numSpeakers = parseInt(event.target.value, 10);
    this.transcriptMerger.setNumSpeakers(this.numSpeakers);
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

      case 'error':
        console.error('Worker error:', message);
        this.loadingMessage.textContent = message;
        this.loadingMessage.className = 'status-error';
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
   * Handle audio chunk from capture
   */
  handleAudioChunk(chunk) {
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
        this.renderSegments(mergedSegments);
        this.transcriptMerger.segments.push(...mergedSegments);

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
        labelEl.innerHTML = `
          ${segment.speakerLabel || 'Unknown'}
          <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
          ${confidenceHtml}
        `;
      } else {
        // Regular speaker segment
        const speakerClass = `speaker-${segment.speaker % 6}`;
        segmentEl.className = `transcript-segment ${speakerClass}`;
        labelEl.className = `speaker-label ${speakerClass}`;
        labelEl.innerHTML = `
          ${segment.speakerLabel}
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

    // Enable copy button
    if (segments.length > 0) {
      this.copyBtn.disabled = false;
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
   * Update chunk queue visualization
   * Shows current processing activity, not history
   */
  updateChunkQueueViz() {
    if (!this.chunkSlots || !this.chunkCounts || !this.chunkProcessing) return;

    const pendingCount = this.pendingChunks.size;
    const queuedCount = this.chunkQueue.length;
    const isActive = this.isRecording || this.isProcessingChunk || pendingCount > 0 || queuedCount > 0;

    // Update processing text
    if (this.isProcessingChunk) {
      this.chunkProcessing.textContent = `Processing chunk #${this.completedChunks + 1}`;
    } else if (pendingCount > 0 || queuedCount > 0) {
      this.chunkProcessing.textContent = 'Waiting...';
    } else if (this.isRecording) {
      this.chunkProcessing.textContent = 'Recording...';
    } else {
      this.chunkProcessing.textContent = 'Idle';
    }

    // Update counts - only show when there's activity
    if (isActive) {
      this.chunkCounts.textContent = `Completed: ${this.completedChunks} | Queued: ${queuedCount}`;
    } else {
      this.chunkCounts.textContent = this.completedChunks > 0
        ? `${this.completedChunks} chunks processed`
        : '';
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
   * Clear raw chunks display
   */
  clearRawChunksDisplay() {
    if (this.rawChunksContainer) {
      this.rawChunksContainer.innerHTML =
        '<p class="placeholder">Raw chunk data will appear here...</p>';
    }
  }

  /**
   * Render raw chunk data from Whisper
   * Shows word-by-word output with timestamps, overlap regions, and merge info
   */
  renderRawChunk(chunkIndex, rawAsr, overlapDuration, mergeInfo) {
    if (!this.rawChunksContainer || !rawAsr) return;

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
    this.clearTranscriptDisplay();
    this.copyBtn.disabled = true;
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

  // ==================== Enrollment Methods ====================

  /**
   * Initialize the speaker visualizer
   */
  initVisualization() {
    this.speakerVisualizer = new SpeakerVisualizer('speaker-canvas');
    this.updateVisualization();
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

    // Switch to recording UI
    this.enrollmentIntro.classList.add('hidden');
    this.enrollmentRecording.classList.remove('hidden');

    // Initialize progress dots
    this.initEnrollmentDots();

    // Show first sentence
    this.updateEnrollmentUI();
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
      this.enrollRecordBtn.textContent = 'Stop';
      this.enrollRecordBtn.classList.add('recording');
      this.setEnrollStatus('Recording... Read the sentence aloud, then click Stop.');

      // Mark current dot as recording
      this.updateCurrentDot('current');
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
    this.enrollRecordBtn.textContent = 'Record';
    this.enrollRecordBtn.classList.remove('recording');
  }

  /**
   * Handle recorded enrollment audio chunk
   */
  handleEnrollmentChunk(chunk) {
    // Check if we have enough audio (at least 1 second)
    if (chunk.audio.length < 16000) {
      this.setEnrollStatus('Recording too short. Please try again.', true);
      this.updateCurrentDot('');
      return;
    }

    this.setEnrollStatus('Processing...');
    this.pendingEnrollmentSampleId = this.enrollmentManager.getCurrentIndex();

    // Send to worker for embedding extraction
    this.worker.postMessage({
      type: 'extract-embedding',
      data: {
        audio: chunk.audio,
        sampleId: this.pendingEnrollmentSampleId,
      },
    });
  }

  /**
   * Handle embedding result from worker
   */
  handleEnrollmentEmbedding(data) {
    const { sampleId, embedding, success, error } = data;

    if (!success) {
      this.setEnrollStatus(`Failed to process: ${error}`, true);
      this.updateCurrentDot('');
      return;
    }

    // Add sample to enrollment manager
    this.enrollmentManager.addSample(embedding);

    // Update UI
    this.updateDotComplete(sampleId);
    this.updateEnrollmentUI();

    // Check if we can finish
    this.enrollFinishBtn.disabled = !this.enrollmentManager.canComplete();

    if (this.enrollmentManager.isComplete()) {
      this.setEnrollStatus('All sentences recorded! Click Finish to complete enrollment.');
    } else {
      this.setEnrollStatus(`Sample ${this.enrollmentManager.getSampleCount()} recorded.`);
    }
  }

  /**
   * Skip current enrollment sentence
   */
  skipEnrollmentSentence() {
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    this.enrollmentManager.skipSentence();
    this.updateDotSkipped(currentIndex);
    this.updateEnrollmentUI();

    if (this.enrollmentManager.isComplete()) {
      if (this.enrollmentManager.canComplete()) {
        this.setEnrollStatus('All sentences processed. Click Finish to complete.');
      } else {
        this.setEnrollStatus('Need at least 2 recordings. Please go back and record more.', true);
      }
    }
  }

  /**
   * Finish enrollment and save
   */
  finishEnrollment() {
    if (!this.enrollmentManager.canComplete()) {
      this.setEnrollStatus('Need at least 2 samples to complete enrollment.', true);
      return;
    }

    // Compute average embedding
    const avgEmbedding = this.enrollmentManager.computeAverageEmbedding();
    const name = this.enrollmentManager.getName();

    // Save to localStorage and get the created enrollment
    const newEnrollment = EnrollmentManager.addEnrollment(name, avgEmbedding);

    // Import into speaker clusterer
    this.transcriptMerger.speakerClusterer.enrollSpeaker(
      name,
      avgEmbedding,
      newEnrollment.id,
      newEnrollment.colorIndex
    );

    // Update UI
    this.renderEnrolledList(EnrollmentManager.loadAll());
    this.showEnrollmentComplete();
    this.updateVisualization();
    this.setEnrollStatus('');
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

    if (currentSentence) {
      this.enrollSentence.textContent = currentSentence;
      this.enrollRecordBtn.disabled = false;
      this.enrollSkipSentenceBtn.disabled = false;
    } else {
      this.enrollSentence.textContent = 'All sentences completed!';
      this.enrollRecordBtn.disabled = true;
      this.enrollSkipSentenceBtn.disabled = true;
    }

    this.enrollProgressText.textContent = `Sample ${sampleCount} of ${total} (Sentence ${Math.min(currentIndex + 1, total)} of ${total})`;
    this.enrollFinishBtn.disabled = !this.enrollmentManager.canComplete();
  }

  /**
   * Initialize progress dots for enrollment
   */
  initEnrollmentDots() {
    this.enrollDots.innerHTML = '';
    const total = this.enrollmentManager.getTotalSentences();
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'progress-dot';
      dot.dataset.index = i;
      this.enrollDots.appendChild(dot);
    }
  }

  /**
   * Update current dot state
   */
  updateCurrentDot(state) {
    const currentIndex = this.enrollmentManager.getCurrentIndex();
    const dot = this.enrollDots.querySelector(`[data-index="${currentIndex}"]`);
    if (dot) {
      dot.className = `progress-dot ${state}`;
    }
  }

  /**
   * Mark dot as complete
   */
  updateDotComplete(index) {
    const dot = this.enrollDots.querySelector(`[data-index="${index}"]`);
    if (dot) {
      dot.className = 'progress-dot complete';
    }
  }

  /**
   * Mark dot as skipped
   */
  updateDotSkipped(index) {
    const dot = this.enrollDots.querySelector(`[data-index="${index}"]`);
    if (dot) {
      dot.className = 'progress-dot skipped';
    }
  }

  /**
   * Set enrollment status message
   */
  setEnrollStatus(message, isError = false) {
    this.enrollStatus.textContent = message;
    this.enrollStatus.className = isError ? 'error' : '';
  }
}
