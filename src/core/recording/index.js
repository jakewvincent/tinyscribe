/**
 * Recording Module
 * Utilities for recording serialization and management
 */

export {
  serializeAudio,
  deserializeAudio,
  serializeChunks,
  deserializeChunks,
  serializeTranscriptionData,
  deserializeTranscriptionData,
  calculateStorageSize,
  generateRecordingName,
  generateRecordingId,
  generateReprocessedName,
  formatDuration,
  formatFileSize,
} from './recordingSerializer.js';

export {
  encodeWav,
  combineChunks,
  downloadBlob,
} from './wavEncoder.js';
