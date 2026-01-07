/**
 * Main Application Controller
 * Coordinates audio capture, worker inference, and UI updates
 */

import { AudioCapture } from './utils/audioCapture.js';
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

    // Carryover audio management (for seamless chunk boundaries)
    this.carryoverAudio = null; // Float32Array of audio to prepend to next chunk
    this.globalTimeOffset = 0; // Tracks global time in the recording
    this.chunkQueue = []; // Queue of pending audio chunks
    this.isProcessingChunk = false; // Flag to ensure sequential processing

    // Components
    this.worker = null;
    this.audioCapture = null;
    this.enrollmentAudioCapture = null;
    this.transcriptMerger = new TranscriptMerger(this.numSpeakers);
    this.enrollmentManager = new EnrollmentManager();
    this.speakerVisualizer = null;
    this.progressItems = new Map();

    // DOM elements - Main controls
    this.loadModelsBtn = document.getElementById('load-models-btn');
    this.recordBtn = document.getElementById('record-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.copyBtn = document.getElementById('copy-btn');
    this.numSpeakersSelect = document.getElementById('num-speakers');
    this.loadingMessage = document.getElementById('loading-message');
    this.progressContainer = document.getElementById('progress-container');
    this.deviceInfo = document.getElementById('device-info');
    this.recordingStatus = document.getElementById('recording-status');
    this.transcriptContainer = document.getElementById('transcript-container');
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

    // Check for WebGPU support
    await this.detectWebGPU();

    // Migrate old single enrollment format if needed
    EnrollmentManager.migrateFromSingle();

    // Load saved enrollments
    this.loadSavedEnrollments();

    // Initialize visualization
    this.initVisualization();
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
    } else if (status === 'error') {
      this.loadModelsBtn.textContent = 'Retry Loading';
      this.loadModelsBtn.disabled = false;
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
    this.pendingChunks.clear();
    this.carryoverAudio = null;
    this.globalTimeOffset = 0;
    this.chunkQueue = [];
    this.isProcessingChunk = false;

    // Create audio capture instance (no overlap - we handle carryover manually)
    this.audioCapture = new AudioCapture({
      chunkDuration: 5,
      onChunkReady: (chunk) => this.handleAudioChunk(chunk),
      onError: (error) => this.handleError(error),
      onAudioLevel: (level) => this.updateAudioLevel(level),
    });

    const success = await this.audioCapture.start();

    if (success) {
      this.isRecording = true;
      this.recordBtn.textContent = 'Stop Recording';
      this.recordBtn.classList.add('recording');
      this.recordingStatus.textContent = 'Recording... Speak into your microphone.';
      this.audioVisualizer.classList.add('active');
    } else {
      this.recordingStatus.textContent =
        'Failed to access microphone. Please check permissions and try again.';
    }
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (this.audioCapture) {
      this.audioCapture.stop();
      this.audioCapture = null;
    }

    this.isRecording = false;
    this.recordBtn.textContent = 'Start Recording';
    this.recordBtn.classList.remove('recording');
    this.audioVisualizer.classList.remove('active');

    if (this.pendingChunks.size > 0) {
      this.recordingStatus.textContent = `Processing ${this.pendingChunks.size} remaining chunk(s)...`;
    } else {
      this.recordingStatus.textContent = 'Recording stopped.';
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

    const processingText = chunk.isFinal
      ? `Processing final chunk...`
      : `Processing chunk ${chunk.index + 1}...`;
    this.recordingStatus.textContent = processingText;

    // Prepend carryover audio from previous chunk (if any)
    let combinedAudio;
    let carryoverDuration = 0;

    if (this.carryoverAudio && this.carryoverAudio.length > 0) {
      carryoverDuration = this.carryoverAudio.length / 16000; // 16kHz sample rate
      combinedAudio = new Float32Array(this.carryoverAudio.length + chunk.audio.length);
      combinedAudio.set(this.carryoverAudio, 0);
      combinedAudio.set(chunk.audio, this.carryoverAudio.length);
    } else {
      combinedAudio = chunk.audio;
    }

    // Track pending chunk with the combined audio for carryover extraction later
    this.pendingChunks.set(chunk.index, {
      globalStartTime: this.globalTimeOffset,
      carryoverDuration,
      combinedAudio, // Store so we can extract carryover after results come back
      isFinal: chunk.isFinal,
    });

    // Show processing indicator
    this.showProcessingIndicator();

    // Send combined audio to worker for transcription
    this.worker.postMessage({
      type: 'transcribe',
      data: {
        audio: combinedAudio,
        language: 'en',
        chunkIndex: chunk.index,
        carryoverDuration,
      },
    });

    // Clear carryover - will be set again when results come back
    this.carryoverAudio = null;
  }

  /**
   * Handle transcription result from worker
   */
  handleTranscriptionResult(data) {
    const { transcript, phrases, chunkIndex, processingTime, splitPoint, carryoverDuration } = data;

    // Get chunk info
    const chunkInfo = this.pendingChunks.get(chunkIndex);
    if (!chunkInfo) {
      console.warn('No chunk info for index', chunkIndex);
      // Continue processing queue even on error
      this.isProcessingChunk = false;
      this.processNextChunk();
      return;
    }

    const { globalStartTime, combinedAudio, isFinal } = chunkInfo;

    // Remove from pending
    this.pendingChunks.delete(chunkIndex);

    // Hide processing indicator if no more pending and queue is empty
    if (this.pendingChunks.size === 0 && this.chunkQueue.length === 0) {
      this.hideProcessingIndicator();
    }

    // Extract carryover audio for next chunk (unless this is final)
    if (!isFinal && combinedAudio) {
      const sampleRate = 16000;
      const splitSample = Math.floor(splitPoint * sampleRate);

      if (splitSample < combinedAudio.length) {
        // Carry over audio from split point to end
        this.carryoverAudio = combinedAudio.slice(splitSample);
      } else {
        this.carryoverAudio = null;
      }

      // Update global time offset: we've processed up to splitPoint
      // But splitPoint is relative to combined audio which includes carryover
      // The "new" audio processed = splitPoint - carryoverDuration
      const newAudioProcessed = splitPoint - carryoverDuration;
      this.globalTimeOffset += Math.max(0, newAudioProcessed);
    } else {
      // Final chunk - process everything, no carryover
      this.carryoverAudio = null;
      const audioDuration = combinedAudio ? combinedAudio.length / 16000 : 0;
      const newAudioProcessed = audioDuration - carryoverDuration;
      this.globalTimeOffset += Math.max(0, newAudioProcessed);
    }

    // Process transcript if we have one
    if (transcript && transcript.text && transcript.text.trim()) {
      // Calculate chunk start time for transcript display
      // Word timestamps from Whisper are relative to combined audio start
      const chunkStartTime = globalStartTime;

      // Merge ASR with phrase-based diarization
      const mergedSegments = this.transcriptMerger.merge(transcript, phrases, chunkStartTime);

      // Render and store segments directly (no deduplication needed with carryover approach)
      if (mergedSegments.length > 0) {
        this.renderSegments(mergedSegments);
        this.transcriptMerger.segments.push(...mergedSegments);
      }
    }

    // Update status
    this.updateRecordingStatus(processingTime);

    // Continue processing queue
    this.isProcessingChunk = false;
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
    } else {
      this.recordingStatus.textContent = 'Recording stopped.';
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
      const speakerClass = `speaker-${segment.speaker % 6}`;

      const segmentEl = document.createElement('div');
      segmentEl.className = `transcript-segment ${speakerClass}`;

      const labelEl = document.createElement('div');
      labelEl.className = `speaker-label ${speakerClass}`;
      labelEl.innerHTML = `
        ${segment.speakerLabel}
        <span class="timestamp">${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}</span>
      `;

      const textEl = document.createElement('div');
      textEl.className = 'segment-text';
      textEl.textContent = segment.text;

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
  }

  /**
   * Clear transcript display only
   */
  clearTranscriptDisplay() {
    this.transcriptContainer.innerHTML =
      '<p class="placeholder">Transcript will appear here when you start recording...</p>';
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
