/**
 * Recording Module
 * Utilities for recording serialization and management
 */

export {
  serializeAudio,
  deserializeAudio,
  serializeChunks,
  deserializeChunks,
  calculateStorageSize,
  generateRecordingName,
  generateRecordingId,
  formatDuration,
  formatFileSize,
} from './recordingSerializer.js';

export {
  encodeWav,
  combineChunks,
  downloadBlob,
} from './wavEncoder.js';
