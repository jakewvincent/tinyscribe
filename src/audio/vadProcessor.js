/**
 * VAD Processor
 * Wraps @ricky0123/vad-web for voice activity detection with speech segment emission
 */

import { MicVAD } from '@ricky0123/vad-web';
import { VAD_DEFAULTS } from '../config/index.js';

export class VADProcessor {
  /**
   * @param {Object} [options] - Configuration options
   * @param {number} [options.minSpeechDuration] - Minimum speech duration in seconds
   * @param {number} [options.maxSpeechDuration] - Maximum speech duration in seconds
   * @param {number} [options.overlapDuration] - Overlap duration in seconds
   * @param {string} [options.model] - VAD model ('legacy' or 'v5')
   * @param {number} [options.positiveSpeechThreshold] - Threshold for speech detection
   * @param {number} [options.negativeSpeechThreshold] - Threshold for silence detection
   * @param {number} [options.redemptionMs] - Wait time before triggering speech end
   * @param {number} [options.preSpeechPadMs] - Audio to include before speech start
   * @param {string} [options.deviceId] - Audio device ID
   * @param {number} [options.channelId] - Channel identifier for dual-input support (default: 0)
   * @param {Function} [options.onSpeechStart] - Callback when speech starts
   * @param {Function} [options.onSpeechEnd] - Callback when speech ends
   * @param {Function} [options.onSpeechProgress] - Callback for progress updates
   * @param {Function} [options.onError] - Error callback
   * @param {Function} [options.onAudioLevel] - Audio level callback
   */
  constructor(options = {}) {
    // Apply defaults from config
    const config = { ...VAD_DEFAULTS, ...options };

    // Speech duration constraints
    this.minSpeechDuration = config.minSpeechDuration;
    this.maxSpeechDuration = config.maxSpeechDuration;

    // Overlap configuration
    this.overlapDuration = config.overlapDuration;
    this.overlapSamples = 16000 * this.overlapDuration;

    // VAD model settings
    this.vadModel = config.model;
    this.positiveSpeechThreshold = config.positiveSpeechThreshold;
    this.negativeSpeechThreshold = config.negativeSpeechThreshold;
    this.redemptionMs = config.redemptionMs;
    this.preSpeechPadMs = config.preSpeechPadMs;

    // Device selection
    this.deviceId = options.deviceId || null;

    // Channel identification (for dual-input support)
    this.channelId = options.channelId ?? 0;

    // Callbacks
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onSpeechProgress = options.onSpeechProgress || (() => {});
    this.onError = options.onError || console.error;
    this.onAudioLevel = options.onAudioLevel || (() => {});

    // Internal state
    this.vad = null;
    this.isListening = false;
    this.chunkIndex = 0;

    // Overlap buffer: tail of previous speech segment
    this.lastSegmentTail = null;

    // Max duration enforcement
    this.speechStartTime = null;
    this.currentSpeechBuffer = [];
    this.maxDurationCheckInterval = null;

    // Sample rate (VAD outputs 16kHz)
    this.sampleRate = 16000;

    // Track the active MediaStream for proper cleanup
    this.activeStream = null;
  }

  /**
   * Initialize the VAD model
   */
  async init() {
    try {
      // Build stream getter with device selection
      const getStream = async () => {
        const constraints = this.deviceId
          ? { audio: { deviceId: { exact: this.deviceId } } }
          : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.activeStream = stream;
        return stream;
      };

      // Callback to stop the microphone when VAD pauses
      const pauseStream = async (stream) => {
        stream.getTracks().forEach((track) => track.stop());
        this.activeStream = null;
      };

      // Callback to get a new stream when VAD resumes
      const resumeStream = async () => {
        return getStream();
      };

      this.vad = await MicVAD.new({
        // Stream configuration
        getStream,
        pauseStream,
        resumeStream,

        // VAD model selection (legacy is more reliable for continuous speech)
        model: this.vadModel,

        // Asset paths - files are copied to /vad/ by vite-plugin-static-copy
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',

        // Speech detection thresholds
        positiveSpeechThreshold: this.positiveSpeechThreshold,
        negativeSpeechThreshold: this.negativeSpeechThreshold,

        // Timing configuration
        redemptionMs: this.redemptionMs,
        preSpeechPadMs: this.preSpeechPadMs,
        minSpeechMs: this.minSpeechDuration * 1000, // Convert to ms

        // Don't start automatically
        startOnLoad: false,

        // Callbacks
        onSpeechStart: () => {
          this.speechStartTime = performance.now();
          this.currentSpeechBuffer = [];
          this.onSpeechStart();

          // Start max duration check
          this.startMaxDurationCheck();
        },

        onSpeechEnd: (audio) => {
          this.stopMaxDurationCheck();
          this.handleSpeechSegment(audio, false);
        },

        onFrameProcessed: (probs, frame) => {
          // Accumulate frames during speech for max duration handling
          if (this.speechStartTime !== null) {
            this.currentSpeechBuffer.push(frame);

            // Calculate RMS for audio level visualization
            let sum = 0;
            for (let i = 0; i < frame.length; i++) {
              sum += frame[i] * frame[i];
            }
            const rms = Math.sqrt(sum / frame.length);
            this.onAudioLevel(rms);

            // Report speech progress
            const duration = (performance.now() - this.speechStartTime) / 1000;
            this.onSpeechProgress({ duration, probability: probs.isSpeech });
          }
        },

        onVADMisfire: () => {
          // Speech was too short, reset state
          this.speechStartTime = null;
          this.currentSpeechBuffer = [];
          this.stopMaxDurationCheck();
        },
      });

      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  /**
   * Start listening for speech
   */
  async start() {
    if (!this.vad) {
      throw new Error('VAD not initialized. Call init() first.');
    }

    this.isListening = true;
    this.chunkIndex = 0;
    this.lastSegmentTail = null;
    this.speechStartTime = null;
    this.currentSpeechBuffer = [];

    await this.vad.start();
  }

  /**
   * Stop listening and emit any pending speech
   */
  async stop() {
    if (!this.vad) return;

    this.stopMaxDurationCheck();

    // If we have accumulated speech, emit it as final
    if (this.currentSpeechBuffer.length > 0) {
      const audio = this.concatenateFrames(this.currentSpeechBuffer);
      this.handleSpeechSegment(audio, true);
    }

    this.isListening = false;
    await this.vad.pause();
  }

  /**
   * Destroy the VAD instance
   */
  async destroy() {
    if (this.vad) {
      this.stopMaxDurationCheck();
      await this.vad.destroy();
      this.vad = null;
    }

    // Ensure any lingering stream is stopped
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => track.stop());
      this.activeStream = null;
    }
  }

  /**
   * Handle a completed speech segment
   * @param {Float32Array} audio - The audio samples
   * @param {boolean} isFinal - Whether this is the final segment (stop requested)
   * @param {boolean} wasForced - Whether this was a forced emit due to max duration
   */
  handleSpeechSegment(audio, isFinal, wasForced = false) {
    const duration = audio.length / this.sampleRate;

    // Skip if too short (shouldn't happen due to minSpeechMs, but safety check)
    if (duration < this.minSpeechDuration && !isFinal) {
      return;
    }

    // Safety check: split oversized audio that exceeds max duration
    // This can happen when MicVAD's onSpeechEnd delivers audio longer than our limit
    const maxDurationWithBuffer = this.maxSpeechDuration * 1.1; // 10% buffer for timing variance
    if (duration > maxDurationWithBuffer && !isFinal) {
      console.warn(`[VAD] Splitting oversized segment: ${duration.toFixed(2)}s exceeds max ${this.maxSpeechDuration}s`);

      // Split into chunks of maxSpeechDuration
      const samplesPerChunk = Math.floor(this.maxSpeechDuration * this.sampleRate);
      let offset = 0;

      while (offset < audio.length) {
        const remainingSamples = audio.length - offset;
        const chunkSamples = Math.min(samplesPerChunk, remainingSamples);
        const chunk = audio.slice(offset, offset + chunkSamples);
        const isLastChunk = offset + chunkSamples >= audio.length;

        // Emit this chunk (recursively, but with wasForced=true to enable overlap)
        this.handleSpeechSegment(chunk, isFinal && isLastChunk, true);

        offset += chunkSamples;
      }
      return;
    }

    // Prepare chunk - only add overlap for forced splits (max duration reached)
    // Natural VAD boundaries don't need overlap since they occur at pauses
    let chunkWithOverlap;
    let overlapDuration = 0;

    if (wasForced && this.lastSegmentTail && this.lastSegmentTail.length > 0) {
      // Prepend overlap from previous segment (only for forced splits)
      overlapDuration = this.lastSegmentTail.length / this.sampleRate;
      chunkWithOverlap = new Float32Array(this.lastSegmentTail.length + audio.length);
      chunkWithOverlap.set(this.lastSegmentTail, 0);
      chunkWithOverlap.set(audio, this.lastSegmentTail.length);
    } else {
      chunkWithOverlap = audio;
    }

    // Save tail only for forced splits - next segment might need it if speech continues
    // Natural VAD boundaries don't need this since they occur at pauses
    if (wasForced && !isFinal && audio.length > this.overlapSamples) {
      this.lastSegmentTail = audio.slice(-this.overlapSamples);
    } else {
      this.lastSegmentTail = null;
    }

    // Emit the speech segment
    this.onSpeechEnd({
      audio: chunkWithOverlap,
      index: this.chunkIndex,
      isFinal,
      overlapDuration,
      rawDuration: duration, // Duration of just this segment (without overlap)
      channelId: this.channelId, // Channel identifier for dual-input support
    });

    this.chunkIndex++;

    // Reset speech state
    this.speechStartTime = null;
    this.currentSpeechBuffer = [];
  }

  /**
   * Start checking for max duration enforcement
   */
  startMaxDurationCheck() {
    this.stopMaxDurationCheck();

    this.maxDurationCheckInterval = setInterval(() => {
      if (this.speechStartTime === null) return;

      const duration = (performance.now() - this.speechStartTime) / 1000;

      if (duration >= this.maxSpeechDuration) {
        // Force emit current speech and continue
        this.forceEmitAndContinue();
      }
    }, 100); // Check every 100ms
  }

  /**
   * Stop max duration checking
   */
  stopMaxDurationCheck() {
    if (this.maxDurationCheckInterval) {
      clearInterval(this.maxDurationCheckInterval);
      this.maxDurationCheckInterval = null;
    }
  }

  /**
   * Force emit current speech segment when max duration reached
   */
  forceEmitAndContinue() {
    if (this.currentSpeechBuffer.length === 0) return;

    const audio = this.concatenateFrames(this.currentSpeechBuffer);
    this.handleSpeechSegment(audio, false, true); // wasForced = true

    // Reset for continued speech - keep the overlap portion in buffer
    if (audio.length > this.overlapSamples) {
      // The tail is already saved in lastSegmentTail by handleSpeechSegment
      // We just need to reset the speech tracking
      this.speechStartTime = performance.now();
      this.currentSpeechBuffer = [];
    }
  }

  /**
   * Concatenate Float32Array frames into a single array
   */
  concatenateFrames(frames) {
    const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const frame of frames) {
      result.set(frame, offset);
      offset += frame.length;
    }
    return result;
  }

  /**
   * Update device ID (requires restart)
   */
  setDeviceId(deviceId) {
    this.deviceId = deviceId;
  }
}
