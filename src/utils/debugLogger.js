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

    this.db = null;
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
    // Load settings from localStorage
    this.enabled = localStorage.getItem(this.config.enabledKey) === 'true';
    this.verbose = localStorage.getItem(this.config.verboseKey) === 'true';

    // Open IndexedDB
    try {
      this.db = await this.openDatabase();
      await this.cleanupOldSessions();
    } catch (err) {
      console.warn('DebugLogger: Failed to open IndexedDB', err);
      // Continue without persistence - logs will be lost on reload
    }

    return this;
  }

  /**
   * Open or create the IndexedDB database
   */
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.storageVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionsStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
          sessionsStore.createIndex('startedAt', 'startedAt');
        }

        // Logs store
        if (!db.objectStoreNames.contains('logs')) {
          const logsStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logsStore.createIndex('sessionId', 'sessionId');
          logsStore.createIndex('type', 'type');
          logsStore.createIndex('sessionType', ['sessionId', 'type']);
        }
      };
    });
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(this.config.enabledKey, enabled ? 'true' : 'false');
    this.notifyStatusChange();
  }

  /**
   * Enable or disable verbose mode
   */
  setVerbose(verbose) {
    this.verbose = verbose;
    localStorage.setItem(this.config.verboseKey, verbose ? 'true' : 'false');
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
    if (!this.db) return null;

    this.sessionId = new Date().toISOString();
    this.chunkIndex = 0;

    const session = {
      sessionId: this.sessionId,
      startedAt: Date.now(),
      endedAt: null,
      logCount: 0,
    };

    try {
      const tx = this.db.transaction('sessions', 'readwrite');
      await tx.objectStore('sessions').add(session);
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
    if (!this.db || !this.sessionId) return;

    try {
      const tx = this.db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const session = await this.promisifyRequest(store.get(this.sessionId));

      if (session) {
        session.endedAt = Date.now();
        await this.promisifyRequest(store.put(session));
      }
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
    if (!this.db || !this.sessionId) return;

    const entry = {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      type,
      chunkIndex,
      data,
    };

    try {
      const tx = this.db.transaction(['logs', 'sessions'], 'readwrite');

      // Add log entry
      await this.promisifyRequest(tx.objectStore('logs').add(entry));

      // Update session log count
      const sessionsStore = tx.objectStore('sessions');
      const session = await this.promisifyRequest(sessionsStore.get(this.sessionId));
      if (session) {
        session.logCount = (session.logCount || 0) + 1;
        await this.promisifyRequest(sessionsStore.put(session));
      }
    } catch (err) {
      console.warn('DebugLogger: Failed to write log', err);
    }
  }

  // ==================== Export Methods ====================

  /**
   * Export a session's logs as JSON
   */
  async exportSession(sessionId) {
    if (!this.db) return null;

    try {
      const tx = this.db.transaction(['sessions', 'logs'], 'readonly');

      // Get session metadata
      const session = await this.promisifyRequest(
        tx.objectStore('sessions').get(sessionId)
      );

      if (!session) {
        console.warn('DebugLogger: Session not found', sessionId);
        return null;
      }

      // Get all logs for this session
      const logsIndex = tx.objectStore('logs').index('sessionId');
      const logs = await this.promisifyRequest(logsIndex.getAll(sessionId));

      const exportData = {
        exportedAt: new Date().toISOString(),
        session,
        logCount: logs.length,
        logs: logs.sort((a, b) => a.timestamp - b.timestamp),
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
   * Export the current active session
   */
  async exportCurrentSession() {
    if (!this.sessionId) {
      console.warn('DebugLogger: No active session');
      return null;
    }
    return this.exportSession(this.sessionId);
  }

  /**
   * Get list of all sessions
   */
  async getSessions() {
    if (!this.db) return [];

    try {
      const tx = this.db.transaction('sessions', 'readonly');
      const sessions = await this.promisifyRequest(tx.objectStore('sessions').getAll());
      return sessions.sort((a, b) => b.startedAt - a.startedAt);
    } catch (err) {
      console.warn('DebugLogger: Failed to get sessions', err);
      return [];
    }
  }

  // ==================== Cleanup Methods ====================

  /**
   * Keep only the most recent N sessions
   */
  async cleanupOldSessions() {
    if (!this.db) return;

    try {
      const sessions = await this.getSessions();

      if (sessions.length <= this.config.maxSessions) return;

      // Sessions to delete (oldest ones beyond maxSessions)
      const toDelete = sessions.slice(this.config.maxSessions);

      for (const session of toDelete) {
        await this.deleteSession(session.sessionId);
      }

      console.log(`DebugLogger: Cleaned up ${toDelete.length} old sessions`);
    } catch (err) {
      console.warn('DebugLogger: Failed to cleanup sessions', err);
    }
  }

  /**
   * Delete a specific session and its logs
   */
  async deleteSession(sessionId) {
    if (!this.db) return;

    try {
      const tx = this.db.transaction(['sessions', 'logs'], 'readwrite');

      // Delete session
      await this.promisifyRequest(tx.objectStore('sessions').delete(sessionId));

      // Delete all logs for this session
      const logsStore = tx.objectStore('logs');
      const logsIndex = logsStore.index('sessionId');
      const logs = await this.promisifyRequest(logsIndex.getAllKeys(sessionId));

      for (const key of logs) {
        await this.promisifyRequest(logsStore.delete(key));
      }
    } catch (err) {
      console.warn('DebugLogger: Failed to delete session', err);
    }
  }

  /**
   * Clear all logs and sessions
   */
  async clearAllLogs() {
    if (!this.db) return;

    try {
      const tx = this.db.transaction(['sessions', 'logs'], 'readwrite');
      await this.promisifyRequest(tx.objectStore('sessions').clear());
      await this.promisifyRequest(tx.objectStore('logs').clear());
      this.notifyStatusChange();
    } catch (err) {
      console.warn('DebugLogger: Failed to clear logs', err);
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Convert IDBRequest to Promise
   */
  promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
