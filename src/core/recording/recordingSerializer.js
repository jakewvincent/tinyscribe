/**
 * Recording Serializer
 * Utilities for serializing/deserializing recording data for IndexedDB storage
 */

/**
 * Serialize a Float32Array to a regular Array for IndexedDB storage
 * @param {Float32Array} float32Array
 * @returns {number[]}
 */
export function serializeAudio(float32Array) {
  return Array.from(float32Array);
}

/**
 * Deserialize an Array back to Float32Array
 * @param {number[]} array
 * @returns {Float32Array}
 */
export function deserializeAudio(array) {
  return new Float32Array(array);
}

/**
 * Serialize audio chunks for storage
 * @param {Object[]} chunks - Array of chunks with Float32Array audio
 * @returns {Object[]} Chunks with serialized audio arrays
 */
export function serializeChunks(chunks) {
  return chunks.map((chunk) => ({
    index: chunk.index,
    audio: serializeAudio(chunk.audio),
    duration: chunk.duration,
    overlapDuration: chunk.overlapDuration || 0,
    isFinal: chunk.isFinal || false,
  }));
}

/**
 * Deserialize audio chunks from storage
 * @param {Object[]} chunks - Array of chunks with number[] audio
 * @returns {Object[]} Chunks with Float32Array audio
 */
export function deserializeChunks(chunks) {
  return chunks.map((chunk) => ({
    index: chunk.index,
    audio: deserializeAudio(chunk.audio),
    duration: chunk.duration,
    overlapDuration: chunk.overlapDuration || 0,
    isFinal: chunk.isFinal || false,
  }));
}

/**
 * Calculate approximate storage size for a recording
 * @param {Object[]} segments - Transcript segments
 * @param {Object[]} chunks - Audio chunks (with Float32Array or Array audio)
 * @returns {number} Approximate size in bytes
 */
export function calculateStorageSize(segments, chunks) {
  // Estimate segments size (JSON overhead)
  const segmentsJson = JSON.stringify(segments);
  const segmentsSize = new Blob([segmentsJson]).size;

  // Audio size: each Float32 is 4 bytes
  const audioSize = chunks.reduce((total, chunk) => {
    const audioLength = chunk.audio?.length || 0;
    return total + audioLength * 4;
  }, 0);

  // Add ~20% overhead for IndexedDB storage
  return Math.round((segmentsSize + audioSize) * 1.2);
}

/**
 * Generate a default recording name
 * @param {string} format - Name format with {date} placeholder
 * @returns {string}
 */
export function generateRecordingName(format = 'Recording {date}') {
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return format.replace('{date}', dateStr);
}

/**
 * Generate a UUID for recording ID
 * @returns {string}
 */
export function generateRecordingId() {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human-readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
