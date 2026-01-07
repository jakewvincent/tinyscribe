/**
 * Audio Capture Utility
 * Handles microphone access, audio streaming, and chunking for transcription
 */

export class AudioCapture {
  constructor(options = {}) {
    // Audio settings (Whisper expects 16kHz mono)
    this.targetSampleRate = 16000;
    this.chunkDuration = options.chunkDuration || 5; // seconds

    // Callbacks
    this.onChunkReady = options.onChunkReady || (() => {});
    this.onError = options.onError || console.error;
    this.onAudioLevel = options.onAudioLevel || (() => {});

    // Internal state
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.isRecording = false;

    // Audio buffer management
    this.audioBuffer = [];
    this.chunkSamples = this.targetSampleRate * this.chunkDuration;
    this.chunkIndex = 0;
    this.recordingStartTime = 0;
  }

  /**
   * Start capturing audio from microphone
   */
  async start() {
    try {
      // Request microphone access - this triggers the permission prompt
      // Start with simple constraints to maximize compatibility
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // Create audio context
      // Note: We create at default sample rate and resample later
      this.audioContext = new AudioContext();

      // Create source from microphone stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

      // Get the actual sample rate
      const inputSampleRate = this.audioContext.sampleRate;

      // Create script processor for capturing samples
      // Buffer size of 4096 is a good balance between latency and performance
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.isRecording) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Resample to 16kHz if needed
        const resampledData = this.resample(inputData, inputSampleRate, this.targetSampleRate);

        // Calculate audio level for visualization (RMS)
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.onAudioLevel(rms);

        // Accumulate samples
        for (let i = 0; i < resampledData.length; i++) {
          this.audioBuffer.push(resampledData[i]);
        }

        // Check if we have enough for a chunk
        if (this.audioBuffer.length >= this.chunkSamples) {
          this.emitChunk();
        }
      };

      // Connect nodes
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isRecording = true;
      this.recordingStartTime = Date.now();

      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  /**
   * Resample audio data to target sample rate
   */
  resample(inputData, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
      return inputData;
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(inputData.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i * ratio;
      const inputIndexFloor = Math.floor(inputIndex);
      const inputIndexCeil = Math.min(inputIndexFloor + 1, inputData.length - 1);
      const fraction = inputIndex - inputIndexFloor;

      // Linear interpolation
      output[i] = inputData[inputIndexFloor] * (1 - fraction) + inputData[inputIndexCeil] * fraction;
    }

    return output;
  }

  /**
   * Emit a chunk of audio for processing
   */
  emitChunk() {
    // Extract chunk (exactly chunkSamples worth)
    const chunk = new Float32Array(this.audioBuffer.slice(0, this.chunkSamples));

    this.onChunkReady({
      audio: chunk,
      index: this.chunkIndex,
      isFinal: false,
    });

    // Clear emitted samples from buffer (no overlap - carryover handled by app.js)
    this.audioBuffer = this.audioBuffer.slice(this.chunkSamples);
    this.chunkIndex++;
  }

  /**
   * Stop recording and cleanup
   */
  stop() {
    this.isRecording = false;

    // Emit any remaining audio as final chunk (if substantial - at least 0.5s)
    if (this.audioBuffer.length > this.targetSampleRate * 0.5) {
      const finalChunk = new Float32Array(this.audioBuffer);

      this.onChunkReady({
        audio: finalChunk,
        index: this.chunkIndex,
        isFinal: true,
      });
    }

    // Cleanup audio nodes
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    // Reset state
    this.audioBuffer = [];
    this.chunkIndex = 0;
  }

  /**
   * Get recording duration in seconds
   */
  getRecordingDuration() {
    if (!this.isRecording) return 0;
    return (Date.now() - this.recordingStartTime) / 1000;
  }
}
