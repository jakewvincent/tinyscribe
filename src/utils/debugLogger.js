/**
 * Debug Logger
 *
 * Persistent logging system using IndexedDB for tracing audio through
 * the processing pipeline. Helps diagnose issues like speaker misattribution
 * or unexpected phrase boundaries.
 *
 * Features:
 * - Session-based organization (one session per recording)
 * - Two verbosity levels (normal / verbose)
 * - Automatic cleanup of old sessions
 * - Export to JSON for analysis
 */

import { DEBUG_DEFAULTS } from '../config/defaults.js';
import { DebugSettingsStore, DebugLogStore } from '../storage/index.js';

/**
 * @typedef {Object} LogEntry
 * @property {number} id - Auto-incremented ID
 * @property {string} sessionId - Session identifier
 * @property {number} timestamp - Unix timestamp
 * @property {string} type - Log type (vad, whisper, phrases, etc.)
 * @property {number|null} chunkIndex - Associated chunk index
 * @property {Object} data - Type-specific payload
 */

/**
 * @typedef {Object} Session
 * @property {string} sessionId - Session identifier (ISO timestamp)
 * @property {number} startedAt - Unix timestamp
 * @property {number|null} endedAt - Unix timestamp when ended
 * @property {number} logCount - Number of log entries
 */

export class DebugLogger {
  constructor(config = {}) {
    this.config = { ...DEBUG_DEFAULTS, ...config };

    this.logStore = new DebugLogStore();
    this.sessionId = null;
    this.enabled = false;
    this.verbose = false;
    this.chunkIndex = 0;

    // Callbacks for UI updates
    this.onStatusChange = null;
  }

  /**
   * Initialize the logger - opens IndexedDB and loads settings
   */
  async init() {
    // Load settings from DebugSettingsStore
    this.enabled = DebugSettingsStore.isEnabled();
    this.verbose = DebugSettingsStore.isVerbose();

    // Initialize IndexedDB via DebugLogStore
    try {
      await this.logStore.init();
      await this.logStore.cleanupOldSessions(this.config.maxSessions);
    } catch (err) {
      console.warn('DebugLogger: Failed to open IndexedDB', err);
      // Continue without persistence - logs will be lost on reload
    }

    return this;
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    DebugSettingsStore.setEnabled(enabled);
    this.notifyStatusChange();
  }

  /**
   * Enable or disable verbose mode
   */
  setVerbose(verbose) {
    this.verbose = verbose;
    DebugSettingsStore.setVerbose(verbose);
    this.notifyStatusChange();
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      enabled: this.enabled,
      verbose: this.verbose,
      hasActiveSession: !!this.sessionId,
      sessionId: this.sessionId,
    };
  }

  /**
   * Start a new logging session (called when recording starts)
   */
  async startSession() {
    if (!this.logStore.isReady()) return null;

    this.sessionId = new Date().toISOString();
    this.chunkIndex = 0;

    try {
      await this.logStore.createSession(this.sessionId);
      this.notifyStatusChange();
    } catch (err) {
      console.warn('DebugLogger: Failed to create session', err);
    }

    return this.sessionId;
  }

  /**
   * End the current session (called when recording stops)
   */
  async endSession() {
    if (!this.logStore.isReady() || !this.sessionId) return;

    try {
      await this.logStore.endSession(this.sessionId);
    } catch (err) {
      console.warn('DebugLogger: Failed to end session', err);
    }

    this.sessionId = null;
    this.notifyStatusChange();
  }

  /**
   * Increment and return the current chunk index
   */
  nextChunkIndex() {
    return this.chunkIndex++;
  }

  /**
   * Get current chunk index without incrementing
   */
  getCurrentChunkIndex() {
    return this.chunkIndex;
  }

  // ==================== Logging Methods ====================
  // Each checks this.enabled before writing

  /**
   * Log VAD chunk emission
   */
  async logVadChunk(data) {
    if (!this.enabled) return;
    await this.writeLog('vad', data.chunkIndex, {
      duration: data.duration,
      wasForced: data.wasForced,
      overlapDuration: data.overlapDuration,
      rawDuration: data.rawDuration,
      isFinal: data.isFinal,
    });
  }

  /**
   * Log raw Whisper ASR output
   */
  async logWhisperResult(data) {
    if (!this.enabled) return;
    await this.writeLog('whisper', data.chunkIndex, {
      text: data.text,
      wordCount: data.wordCount,
      language: data.language,
      // Verbose: include full word list
      words: this.verbose ? data.words : undefined,
    });
  }

  /**
   * Log phrase detection results
   */
  async logPhraseDetection(data) {
    if (!this.enabled) return;
    await this.writeLog('phrases', data.chunkIndex, {
      phraseCount: data.phraseCount,
      phrases: data.phrases?.map(p => ({
        text: p.text,
        start: p.start,
        end: p.end,
        duration: p.duration,
        wordCount: p.wordCount,
      })),
    });
  }

  /**
   * Log embedding extraction results
   */
  async logEmbeddingExtraction(data) {
    if (!this.enabled) return;
    await this.writeLog('embeddings', data.chunkIndex, {
      results: data.results?.map(r => ({
        phraseIndex: r.phraseIndex,
        frameCount: r.frameCount,
        hasEmbedding: r.hasEmbedding,
        reason: r.reason,
        // Verbose: include actual embedding
        embedding: this.verbose ? r.embedding : undefined,
      })),
    });
  }

  /**
   * Log overlap merge decisions
   */
  async logOverlapMerge(data) {
    if (!this.enabled) return;
    await this.writeLog('overlap', data.chunkIndex, {
      hadPreviousChunk: data.hadPreviousChunk,
      overlapDuration: data.overlapDuration,
      mergeMethod: data.mergeMethod,
      mergeConfidence: data.mergeConfidence,
      wordsDropped: data.wordsDropped,
      matchedWords: data.matchedWords,
    });
  }

  /**
   * Log speaker clustering decisions
   */
  async logClustering(data) {
    if (!this.enabled) return;
    await this.writeLog('clustering', data.chunkIndex, {
      phraseIndex: data.phraseIndex,
      text: data.text?.substring(0, 100),
      duration: data.duration,
      frameCount: data.frameCount,
      assignedSpeaker: data.assignedSpeaker,
      similarity: data.similarity,
      margin: data.margin,
      reason: data.reason,
      // Verbose: include all similarities
      allSimilarities: this.verbose ? data.allSimilarities : undefined,
    });
  }

  /**
   * Log final segment creation
   */
  async logSegmentCreation(data) {
    if (!this.enabled) return;
    await this.writeLog('segment', data.chunkIndex, {
      segmentCount: data.segmentCount,
      segments: data.segments?.map(s => ({
        text: s.text?.substring(0, 100),
        speaker: s.speaker,
        duration: s.duration,
        isEnvironmental: s.isEnvironmental,
        clusteringReason: s.clusteringReason,
      })),
    });
  }

  /**
   * Log conversation inference decisions
   */
  async logInference(data) {
    if (!this.enabled) return;
    await this.writeLog('inference', data.chunkIndex, {
      hypothesisVersion: data.hypothesisVersion,
      participants: data.participants,
      segmentsChanged: data.segmentsChanged,
      boostedAttributions: data.boostedAttributions,
    });
  }

  /**
   * Generic log method for custom entries
   */
  async log(type, data) {
    if (!this.enabled) return;
    await this.writeLog(type, data.chunkIndex ?? null, data);
  }

  // ==================== Internal Methods ====================

  /**
   * Write a log entry to IndexedDB
   */
  async writeLog(type, chunkIndex, data) {
    if (!this.logStore.isReady() || !this.sessionId) return;

    const entry = {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      type,
      chunkIndex,
      data,
    };

    try {
      await this.logStore.addLog(entry);
    } catch (err) {
      console.warn('DebugLogger: Failed to write log', err);
    }
  }

  // ==================== Export Methods ====================

  /**
   * Export a session's logs as JSON
   */
  async exportSession(sessionId) {
    if (!this.logStore.isReady()) return null;

    try {
      // Get session metadata
      const session = await this.logStore.getSession(sessionId);

      if (!session) {
        console.warn('DebugLogger: Session not found', sessionId);
        return null;
      }

      // Get all logs for this session (already sorted by timestamp)
      const logs = await this.logStore.getLogsBySession(sessionId);

      const exportData = {
        exportedAt: new Date().toISOString(),
        session,
        logCount: logs.length,
        logs,
      };

      // Trigger download
      this.downloadJson(exportData, `debug-logs-${sessionId.replace(/[:.]/g, '-')}.json`);

      return exportData;
    } catch (err) {
      console.error('DebugLogger: Failed to export session', err);
      return null;
    }
  }

  /**
   * Export the current active session, or the most recent session if none is active
   */
  async exportCurrentSession() {
    let sessionIdToExport = this.sessionId;

    // If no active session, try to export the most recent one
    if (!sessionIdToExport) {
      const sessions = await this.getSessions();
      if (sessions.length > 0) {
        sessionIdToExport = sessions[0].sessionId;
        console.log('DebugLogger: No active session, exporting most recent:', sessionIdToExport);
      } else {
        console.warn('DebugLogger: No sessions available to export');
        return null;
      }
    }

    return this.exportSession(sessionIdToExport);
  }

  /**
   * Get list of all sessions
   */
  async getSessions() {
    if (!this.logStore.isReady()) return [];

    try {
      return await this.logStore.getAllSessions();
    } catch (err) {
      console.warn('DebugLogger: Failed to get sessions', err);
      return [];
    }
  }

  // ==================== Cleanup Methods ====================

  /**
   * Delete a specific session and its logs
   */
  async deleteSession(sessionId) {
    if (!this.logStore.isReady()) return;

    try {
      await this.logStore.deleteSession(sessionId);
    } catch (err) {
      console.warn('DebugLogger: Failed to delete session', err);
    }
  }

  /**
   * Clear all logs and sessions
   */
  async clearAllLogs() {
    if (!this.logStore.isReady()) return;

    try {
      await this.logStore.clearAll();
      this.notifyStatusChange();
    } catch (err) {
      console.warn('DebugLogger: Failed to clear logs', err);
    }
  }

  /**
   * Download data as JSON file
   */
  downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Notify UI of status changes
   */
  notifyStatusChange() {
    if (this.onStatusChange) {
      this.onStatusChange(this.getSettings());
    }
  }

  /**
   * Get status for UI display
   */
  async getStatus() {
    const sessions = await this.getSessions();
    return {
      ...this.getSettings(),
      sessionCount: sessions.length,
      currentSessionLogs: this.sessionId
        ? (sessions.find(s => s.sessionId === this.sessionId)?.logCount || 0)
        : 0,
    };
  }
}

export default DebugLogger;
