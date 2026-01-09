/**
 * Debug Panel
 * UI controls for debug logging settings
 *
 * Provides toggles for enable/verbose mode and buttons for export/clear
 */

export class DebugPanel {
  /**
   * @param {Object} options - Configuration options
   * @param {import('../../utils/debugLogger.js').DebugLogger} options.logger - DebugLogger instance
   * @param {string} [options.enabledId='debug-enabled'] - Enabled checkbox ID
   * @param {string} [options.verboseId='debug-verbose'] - Verbose checkbox ID
   * @param {string} [options.verboseRowId='verbose-row'] - Verbose row container ID
   * @param {string} [options.exportBtnId='debug-export'] - Export button ID
   * @param {string} [options.clearBtnId='debug-clear'] - Clear button ID
   * @param {string} [options.statusId='debug-status'] - Status element ID
   */
  constructor(options = {}) {
    this.logger = options.logger;

    // Element IDs
    this.enabledId = options.enabledId || 'debug-enabled';
    this.verboseId = options.verboseId || 'debug-verbose';
    this.verboseRowId = options.verboseRowId || 'verbose-row';
    this.exportBtnId = options.exportBtnId || 'debug-export';
    this.clearBtnId = options.clearBtnId || 'debug-clear';
    this.statusId = options.statusId || 'debug-status';

    // Bound event handlers
    this.handleEnabledChange = this.handleEnabledChange.bind(this);
    this.handleVerboseChange = this.handleVerboseChange.bind(this);
    this.handleExportClick = this.handleExportClick.bind(this);
    this.handleClearClick = this.handleClearClick.bind(this);
  }

  /**
   * Initialize the panel - attach event listeners and sync state
   */
  init() {
    const enabledCheckbox = document.getElementById(this.enabledId);
    const verboseCheckbox = document.getElementById(this.verboseId);
    const exportBtn = document.getElementById(this.exportBtnId);
    const clearBtn = document.getElementById(this.clearBtnId);

    if (enabledCheckbox) {
      enabledCheckbox.addEventListener('change', this.handleEnabledChange);
    }
    if (verboseCheckbox) {
      verboseCheckbox.addEventListener('change', this.handleVerboseChange);
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', this.handleExportClick);
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', this.handleClearClick);
    }

    // Set up logger callback
    if (this.logger) {
      this.logger.onStatusChange = (settings) => this.syncState(settings);
    }

    // Initial state sync
    this.syncState(this.logger?.getSettings());
  }

  /**
   * Sync UI state with logger settings
   */
  syncState(settings) {
    const enabledCheckbox = document.getElementById(this.enabledId);
    const verboseCheckbox = document.getElementById(this.verboseId);
    const verboseRow = document.getElementById(this.verboseRowId);
    const exportBtn = document.getElementById(this.exportBtnId);
    const clearBtn = document.getElementById(this.clearBtnId);

    const enabled = settings?.enabled ?? false;
    const verbose = settings?.verbose ?? false;
    const hasSession = settings?.hasActiveSession ?? false;

    // Update checkboxes
    if (enabledCheckbox) {
      enabledCheckbox.checked = enabled;
    }
    if (verboseCheckbox) {
      verboseCheckbox.checked = verbose;
      verboseCheckbox.disabled = !enabled;
    }

    // Update verbose row styling
    if (verboseRow) {
      verboseRow.classList.toggle('disabled', !enabled);
    }

    // Update buttons
    if (exportBtn) {
      exportBtn.disabled = !enabled || !hasSession;
    }
    if (clearBtn) {
      clearBtn.disabled = !enabled;
    }

    // Update status
    this.updateStatus();
  }

  /**
   * Handle enabled checkbox change
   */
  handleEnabledChange(event) {
    const enabled = event.target.checked;
    if (this.logger) {
      this.logger.setEnabled(enabled);
    }
  }

  /**
   * Handle verbose checkbox change
   */
  handleVerboseChange(event) {
    const verbose = event.target.checked;
    if (this.logger) {
      this.logger.setVerbose(verbose);
    }
  }

  /**
   * Handle export button click
   */
  async handleExportClick() {
    if (this.logger) {
      const exportBtn = document.getElementById(this.exportBtnId);
      if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Exporting...';
      }

      try {
        await this.logger.exportCurrentSession();
      } finally {
        if (exportBtn) {
          exportBtn.disabled = false;
          exportBtn.textContent = 'Export Logs';
        }
      }
    }
  }

  /**
   * Handle clear button click
   */
  async handleClearClick() {
    if (!this.logger) return;

    const confirmed = confirm('Clear all debug logs? This cannot be undone.');
    if (!confirmed) return;

    const clearBtn = document.getElementById(this.clearBtnId);
    if (clearBtn) {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Clearing...';
    }

    try {
      await this.logger.clearAllLogs();
      this.updateStatus();
    } finally {
      if (clearBtn) {
        clearBtn.disabled = false;
        clearBtn.textContent = 'Clear Logs';
      }
    }
  }

  /**
   * Update status display
   */
  async updateStatus() {
    const statusEl = document.getElementById(this.statusId);
    if (!statusEl || !this.logger) return;

    const status = await this.logger.getStatus();

    if (!status.enabled) {
      statusEl.textContent = 'Logging disabled';
      statusEl.className = 'debug-status status-disabled';
      return;
    }

    const parts = [];

    if (status.hasActiveSession) {
      parts.push(`Recording: ${status.currentSessionLogs} logs`);
    } else {
      parts.push('Ready');
    }

    if (status.sessionCount > 0) {
      parts.push(`${status.sessionCount} session${status.sessionCount !== 1 ? 's' : ''} stored`);
    }

    if (status.verbose) {
      parts.push('(verbose)');
    }

    statusEl.textContent = parts.join(' • ');
    statusEl.className = 'debug-status status-enabled';
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    const enabledCheckbox = document.getElementById(this.enabledId);
    const verboseCheckbox = document.getElementById(this.verboseId);
    const exportBtn = document.getElementById(this.exportBtnId);
    const clearBtn = document.getElementById(this.clearBtnId);

    if (enabledCheckbox) {
      enabledCheckbox.removeEventListener('change', this.handleEnabledChange);
    }
    if (verboseCheckbox) {
      verboseCheckbox.removeEventListener('change', this.handleVerboseChange);
    }
    if (exportBtn) {
      exportBtn.removeEventListener('click', this.handleExportClick);
    }
    if (clearBtn) {
      clearBtn.removeEventListener('click', this.handleClearClick);
    }

    if (this.logger) {
      this.logger.onStatusChange = null;
    }
  }
}

export default DebugPanel;
