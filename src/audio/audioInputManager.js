/**
 * Audio Input Manager
 * Manages multiple audio input channels for dual-input recording
 * (e.g., microphone + system audio loopback)
 */

import { VADProcessor } from './vadProcessor.js';

export class AudioInputManager {
  /**
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.onChunkReady] - Callback when a chunk is ready from any channel
   * @param {Function} [options.onSpeechStart] - Callback when speech starts on a channel
   * @param {Function} [options.onSpeechProgress] - Callback for speech progress updates
   * @param {Function} [options.onAudioLevel] - Callback for audio level updates
   * @param {Function} [options.onError] - Error callback
   */
  constructor(options = {}) {
    this.inputs = new Map(); // channelId -> { vadProcessor, config, isActive }
    this.recordingStartTime = null;

    // Callbacks
    this.onChunkReady = options.onChunkReady || (() => {});
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechProgress = options.onSpeechProgress || (() => {});
    this.onAudioLevel = options.onAudioLevel || (() => {});
    this.onError = options.onError || console.error;
    this.onDeviceDisconnected = options.onDeviceDisconnected || (() => {});

    // Monitor for device changes
    this.handleDeviceChange = this.handleDeviceChange.bind(this);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
    }
  }

  /**
   * Add an audio input channel
   * @param {number} channelId - Channel identifier (0, 1, etc.)
   * @param {Object} config - Channel configuration
   * @param {string} [config.deviceId] - Audio device ID (null for default)
   * @param {number} [config.expectedSpeakers] - Expected number of speakers on this channel
   * @param {string} [config.label] - Human-readable label for this channel
   * @param {Object} [config.vadOptions] - Additional VAD options
   */
  async addInput(channelId, config) {
    if (this.inputs.has(channelId)) {
      console.warn(`[AudioInputManager] Channel ${channelId} already exists, removing first`);
      await this.removeInput(channelId);
    }

    const vadProcessor = new VADProcessor({
      deviceId: config.deviceId || null,
      channelId: channelId,
      ...config.vadOptions,
      onSpeechStart: () => {
        this.onSpeechStart(channelId);
      },
      onSpeechEnd: (chunk) => {
        this.handleChunk(channelId, chunk);
      },
      onSpeechProgress: (progress) => {
        this.onSpeechProgress(channelId, progress);
      },
      onAudioLevel: (level) => {
        this.onAudioLevel(channelId, level);
      },
      onError: (error) => {
        console.error(`[AudioInputManager] Error on channel ${channelId}:`, error);
        this.onError(channelId, error);
      },
    });

    this.inputs.set(channelId, {
      vadProcessor,
      config: {
        deviceId: config.deviceId || null,
        expectedSpeakers: config.expectedSpeakers ?? 2,
        label: config.label || `Input ${channelId + 1}`,
      },
      isActive: false,
    });

    return vadProcessor;
  }

  /**
   * Remove an audio input channel
   * @param {number} channelId - Channel identifier to remove
   */
  async removeInput(channelId) {
    const input = this.inputs.get(channelId);
    if (!input) {
      return;
    }

    if (input.isActive) {
      try {
        await input.vadProcessor.stop();
      } catch (e) {
        console.warn(`[AudioInputManager] Error stopping channel ${channelId}:`, e);
      }
    }

    try {
      await input.vadProcessor.destroy();
    } catch (e) {
      console.warn(`[AudioInputManager] Error destroying channel ${channelId}:`, e);
    }

    this.inputs.delete(channelId);
  }

  /**
   * Initialize all configured inputs
   */
  async initAll() {
    const initPromises = [];
    for (const [channelId, input] of this.inputs) {
      initPromises.push(
        input.vadProcessor.init().catch((error) => {
          console.error(`[AudioInputManager] Failed to init channel ${channelId}:`, error);
          throw error;
        })
      );
    }
    await Promise.all(initPromises);
  }

  /**
   * Start all configured inputs
   */
  async startAll() {
    this.recordingStartTime = performance.now();

    // Initialize all first
    await this.initAll();

    // Start all
    const startPromises = [];
    for (const [channelId, input] of this.inputs) {
      startPromises.push(
        input.vadProcessor.start().then(() => {
          input.isActive = true;
        }).catch((error) => {
          console.error(`[AudioInputManager] Failed to start channel ${channelId}:`, error);
          throw error;
        })
      );
    }
    await Promise.all(startPromises);
  }

  /**
   * Stop all active inputs
   */
  async stopAll() {
    const stopPromises = [];
    for (const [channelId, input] of this.inputs) {
      if (input.isActive) {
        stopPromises.push(
          input.vadProcessor.stop().then(() => {
            input.isActive = false;
          }).catch((error) => {
            console.error(`[AudioInputManager] Failed to stop channel ${channelId}:`, error);
          })
        );
      }
    }
    await Promise.all(stopPromises);
  }

  /**
   * Destroy all inputs and clean up
   */
  async destroyAll() {
    await this.stopAll();

    const destroyPromises = [];
    for (const [channelId, input] of this.inputs) {
      destroyPromises.push(
        input.vadProcessor.destroy().catch((error) => {
          console.error(`[AudioInputManager] Failed to destroy channel ${channelId}:`, error);
        })
      );
    }
    await Promise.all(destroyPromises);

    this.inputs.clear();

    // Remove device change listener
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange);
    }
  }

  /**
   * Handle a chunk from a specific channel
   * Adds wall-clock timestamp for chronological ordering across channels
   * @param {number} channelId - Source channel
   * @param {Object} chunk - The audio chunk from VADProcessor
   */
  handleChunk(channelId, chunk) {
    // Add wall-clock timestamp relative to recording start
    const wallTime = this.recordingStartTime
      ? performance.now() - this.recordingStartTime
      : 0;

    // Augment chunk with channel info and timing
    const augmentedChunk = {
      ...chunk,
      channelId,
      wallTime,
    };

    this.onChunkReady(augmentedChunk);
  }

  /**
   * Handle device changes (connection/disconnection)
   */
  async handleDeviceChange() {
    // Get current devices
    let currentDevices = [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      currentDevices = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => d.deviceId);
    } catch (e) {
      console.warn('[AudioInputManager] Failed to enumerate devices:', e);
      return;
    }

    // Check each active input
    for (const [channelId, input] of this.inputs) {
      if (input.config.deviceId && input.isActive) {
        const stillExists = currentDevices.includes(input.config.deviceId);
        if (!stillExists) {
          console.warn(`[AudioInputManager] Device disconnected for channel ${channelId}: ${input.config.deviceId}`);
          this.onDeviceDisconnected(channelId, input.config.deviceId);
        }
      }
    }
  }

  /**
   * Get the configuration for a specific channel
   * @param {number} channelId - Channel identifier
   * @returns {Object|undefined} Channel configuration
   */
  getChannelConfig(channelId) {
    return this.inputs.get(channelId)?.config;
  }

  /**
   * Get all channel configurations
   * @returns {Map<number, Object>} Map of channelId -> config
   */
  getAllConfigs() {
    const configs = new Map();
    for (const [channelId, input] of this.inputs) {
      configs.set(channelId, input.config);
    }
    return configs;
  }

  /**
   * Check if any inputs are active
   * @returns {boolean}
   */
  get isActive() {
    for (const input of this.inputs.values()) {
      if (input.isActive) return true;
    }
    return false;
  }

  /**
   * Get the number of configured inputs
   * @returns {number}
   */
  get inputCount() {
    return this.inputs.size;
  }
}
