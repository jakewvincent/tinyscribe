/**
 * Debug Log Store
 * IndexedDB storage for debug sessions and log entries
 */

import { IndexedDBAdapter } from '../indexedDBAdapter.js';
import { INDEXED_DB_CONFIG } from '../../keys.js';

const config = INDEXED_DB_CONFIG.DEBUG_LOGS;

/**
 * @typedef {Object} Session
 * @property {string} sessionId - ISO timestamp identifier
 * @property {number} startedAt - Unix timestamp (ms)
 * @property {number|null} endedAt - Unix timestamp (ms) or null if active
 * @property {number} logCount - Count of associated log entries
 */

/**
 * @typedef {Object} LogEntry
 * @property {number} [id] - Auto-incremented primary key
 * @property {string} sessionId - Foreign key to session
 * @property {number} timestamp - Unix timestamp (ms)
 * @property {string} type - Log type (vad, whisper, phrases, etc.)
 * @property {number|null} chunkIndex - Associated audio chunk index
 * @property {Object} data - Type-specific payload
 */

export class DebugLogStore {
  constructor() {
    this.adapter = new IndexedDBAdapter(config.name, config.version);
  }

  /**
   * Initialize the database (creates schema if needed)
   * @returns {Promise<void>}
   */
  async init() {
    await this.adapter.open((db) => {
      // Sessions store
      if (!db.objectStoreNames.contains(config.stores.SESSIONS)) {
        const sessionsStore = db.createObjectStore(config.stores.SESSIONS, {
          keyPath: 'sessionId',
        });
        sessionsStore.createIndex('startedAt', 'startedAt');
      }

      // Logs store
      if (!db.objectStoreNames.contains(config.stores.LOGS)) {
        const logsStore = db.createObjectStore(config.stores.LOGS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        logsStore.createIndex('sessionId', 'sessionId');
        logsStore.createIndex('type', 'type');
        logsStore.createIndex('sessionType', ['sessionId', 'type']);
      }
    });
  }

  /**
   * Check if database is ready
   * @returns {boolean}
   */
  isReady() {
    return this.adapter.isOpen();
  }

  // ==================== Session Methods ====================

  /**
   * Create a new session
   * @param {string} sessionId - ISO timestamp identifier
   * @returns {Promise<Session>}
   */
  async createSession(sessionId) {
    const session = {
      sessionId,
      startedAt: Date.now(),
      endedAt: null,
      logCount: 0,
    };
    await this.adapter.add(config.stores.SESSIONS, session);
    return session;
  }

  /**
   * End a session (set endedAt timestamp)
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async endSession(sessionId) {
    const session = await this.adapter.get(config.stores.SESSIONS, sessionId);
    if (session) {
      session.endedAt = Date.now();
      await this.adapter.put(config.stores.SESSIONS, session);
    }
  }

  /**
   * Get a session by ID
   * @param {string} sessionId
   * @returns {Promise<Session|undefined>}
   */
  async getSession(sessionId) {
    return this.adapter.get(config.stores.SESSIONS, sessionId);
  }

  /**
   * Get all sessions, sorted by startedAt descending (newest first)
   * @returns {Promise<Session[]>}
   */
  async getAllSessions() {
    const sessions = await this.adapter.getAll(config.stores.SESSIONS);
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Delete a session and all its logs
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async deleteSession(sessionId) {
    // Get all log keys for this session
    const logKeys = await this.adapter.getAllKeysByIndex(
      config.stores.LOGS,
      'sessionId',
      sessionId
    );

    // Delete all logs
    for (const key of logKeys) {
      await this.adapter.delete(config.stores.LOGS, key);
    }

    // Delete the session
    await this.adapter.delete(config.stores.SESSIONS, sessionId);
  }

  // ==================== Log Methods ====================

  /**
   * Add a log entry
   * @param {Omit<LogEntry, 'id'>} entry
   * @returns {Promise<number>} The log entry ID
   */
  async addLog(entry) {
    const id = await this.adapter.add(config.stores.LOGS, entry);

    // Update session log count
    const session = await this.adapter.get(config.stores.SESSIONS, entry.sessionId);
    if (session) {
      session.logCount = (session.logCount || 0) + 1;
      await this.adapter.put(config.stores.SESSIONS, session);
    }

    return id;
  }

  /**
   * Get all logs for a session, sorted by timestamp
   * @param {string} sessionId
   * @returns {Promise<LogEntry[]>}
   */
  async getLogsBySession(sessionId) {
    const logs = await this.adapter.getAllByIndex(
      config.stores.LOGS,
      'sessionId',
      sessionId
    );
    return logs.sort((a, b) => a.timestamp - b.timestamp);
  }

  // ==================== Cleanup Methods ====================

  /**
   * Keep only the N most recent sessions, delete older ones
   * @param {number} maxSessions
   * @returns {Promise<number>} Number of sessions deleted
   */
  async cleanupOldSessions(maxSessions) {
    const sessions = await this.getAllSessions();
    if (sessions.length <= maxSessions) return 0;

    const toDelete = sessions.slice(maxSessions);
    for (const session of toDelete) {
      await this.deleteSession(session.sessionId);
    }
    return toDelete.length;
  }

  /**
   * Clear all sessions and logs
   * @returns {Promise<void>}
   */
  async clearAll() {
    await this.adapter.clearAll([config.stores.SESSIONS, config.stores.LOGS]);
  }

  /**
   * Close the database connection
   */
  close() {
    this.adapter.close();
  }
}

export default DebugLogStore;
