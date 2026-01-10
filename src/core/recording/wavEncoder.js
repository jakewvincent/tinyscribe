/**
 * WAV Encoder
 * Converts Float32Array audio samples to WAV format for download
 */

/**
 * Encode audio samples as a WAV file
 * @param {Float32Array} samples - Audio samples (range -1.0 to 1.0)
 * @param {number} sampleRate - Sample rate in Hz (default 16000)
 * @returns {Blob} WAV file as a Blob
 */
export function encodeWav(samples, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Write WAV header
  // "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true); // File size - 8 bytes for RIFF header
  writeString(view, 8, 'WAVE');

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write audio samples as 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp to -1.0 to 1.0 range and convert to 16-bit integer
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Write a string to a DataView at a specific offset
 */
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Combine multiple Float32Array chunks into a single array
 * @param {Array<{audio: Float32Array}>} chunks - Array of audio chunks
 * @returns {Float32Array} Combined audio samples
 */
export function combineChunks(chunks) {
  // Calculate total length
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.audio.length, 0);
  const combined = new Float32Array(totalLength);

  // Copy each chunk
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk.audio, offset);
    offset += chunk.audio.length;
  }

  return combined;
}

/**
 * Trigger download of a blob as a file
 * @param {Blob} blob - The blob to download
 * @param {string} filename - The filename for the download
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default { encodeWav, combineChunks, downloadBlob };
