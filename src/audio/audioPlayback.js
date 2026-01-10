/**
 * Audio Playback
 * Web Audio API-based playback for saved recording chunks
 */

export class AudioPlayback {
  /**
   * @param {Object} options
   * @param {Function} [options.onProgress] - Called with { time, duration, playing }
   * @param {Function} [options.onEnded] - Called when playback finishes
   */
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onEnded = options.onEnded || (() => {});

    this.audioContext = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.startTime = 0; // AudioContext time when playback started
    this.pauseTime = 0; // Position in seconds when paused
    this.isPlaying = false;
    this.duration = 0;
    this.progressInterval = null;
  }

  /**
   * Load audio chunks for playback
   * @param {Object[]} chunks - Array of chunks with Float32Array audio
   * @param {number} [sampleRate=16000] - Sample rate of audio
   */
  async load(chunks, sampleRate = 16000) {
    // Create AudioContext if needed
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Calculate total length
    let totalSamples = 0;
    for (const chunk of chunks) {
      totalSamples += chunk.audio.length;
    }

    // Create AudioBuffer
    this.audioBuffer = this.audioContext.createBuffer(1, totalSamples, sampleRate);
    const channelData = this.audioBuffer.getChannelData(0);

    // Copy all chunks into buffer
    let offset = 0;
    for (const chunk of chunks) {
      channelData.set(chunk.audio, offset);
      offset += chunk.audio.length;
    }

    this.duration = this.audioBuffer.duration;
    this.pauseTime = 0;

    return this.duration;
  }

  /**
   * Start or resume playback
   */
  play() {
    if (!this.audioBuffer || this.isPlaying) return;

    // Resume context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Create source node
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.audioContext.destination);

    // Handle playback end
    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pauseTime = this.duration;
        this.stopProgressUpdates();
        this.onEnded();
        this.onProgress({
          time: this.duration,
          duration: this.duration,
          playing: false,
        });
      }
    };

    // Start playback from pause position
    this.startTime = this.audioContext.currentTime - this.pauseTime;
    this.sourceNode.start(0, this.pauseTime);
    this.isPlaying = true;

    // Start progress updates
    this.startProgressUpdates();
  }

  /**
   * Pause playback
   */
  pause() {
    if (!this.isPlaying || !this.sourceNode) return;

    // Calculate current position
    this.pauseTime = this.audioContext.currentTime - this.startTime;

    // Stop source node
    this.sourceNode.onended = null; // Prevent onended callback
    this.sourceNode.stop();
    this.sourceNode = null;
    this.isPlaying = false;

    this.stopProgressUpdates();
    this.onProgress({
      time: this.pauseTime,
      duration: this.duration,
      playing: false,
    });
  }

  /**
   * Toggle play/pause
   */
  toggle() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Seek to a specific time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    const wasPlaying = this.isPlaying;

    // Clamp time to valid range
    time = Math.max(0, Math.min(time, this.duration));

    // Stop current playback
    if (this.isPlaying) {
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.sourceNode = null;
      this.isPlaying = false;
    }

    // Update position
    this.pauseTime = time;

    // Report progress
    this.onProgress({
      time: this.pauseTime,
      duration: this.duration,
      playing: wasPlaying,
    });

    // Resume if was playing
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Get current playback time
   * @returns {number} Current time in seconds
   */
  getCurrentTime() {
    if (this.isPlaying) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pauseTime;
  }

  /**
   * Start progress update interval
   */
  startProgressUpdates() {
    this.stopProgressUpdates();
    this.progressInterval = setInterval(() => {
      if (this.isPlaying) {
        const time = this.getCurrentTime();
        this.onProgress({
          time: Math.min(time, this.duration),
          duration: this.duration,
          playing: true,
        });
      }
    }, 100);
  }

  /**
   * Stop progress update interval
   */
  stopProgressUpdates() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Stop playback and reset to beginning
   */
  stop() {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this.pauseTime = 0;
    this.stopProgressUpdates();
    this.onProgress({
      time: 0,
      duration: this.duration,
      playing: false,
    });
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffer = null;
  }
}

export default AudioPlayback;
