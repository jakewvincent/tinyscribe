/**
 * Participants Panel
 * Displays hypothesized conversation participants with confidence indicators
 *
 * Reusable component - accepts container element or ID
 */

import { SPEAKER_COLORS } from '../../config/index.js';

export class ParticipantsPanel {
  /**
   * @param {Object} options - Configuration options
   * @param {HTMLElement} [options.container] - Container element
   * @param {string} [options.containerId] - Container element ID (alternative)
   * @param {string} [options.listId='participants-list'] - List element ID
   * @param {string} [options.statusId='participants-status'] - Status element ID
   * @param {string[]} [options.colors] - Custom color palette
   */
  constructor(options = {}) {
    // Resolve container element
    if (options.container) {
      this.container = options.container;
    } else if (options.containerId) {
      this.container = document.getElementById(options.containerId);
    } else {
      this.container = null;
    }

    this.listId = options.listId || 'participants-list';
    this.statusId = options.statusId || 'participants-status';
    this.colors = options.colors || SPEAKER_COLORS;

    // Track previous state for change detection
    this.previousVersion = -1;
    this.previousParticipants = [];
  }

  /**
   * Set container element
   * @param {HTMLElement} container - Container element
   */
  setContainer(container) {
    this.container = container;
  }

  /**
   * Get list element
   * @returns {HTMLElement|null}
   */
  getListElement() {
    return document.getElementById(this.listId);
  }

  /**
   * Get status element
   * @returns {HTMLElement|null}
   */
  getStatusElement() {
    return document.getElementById(this.statusId);
  }

  /**
   * Render the panel with current hypothesis
   * @param {Object} hypothesis - From conversationInference.getHypothesis()
   * @param {Object} [enrolledSpeakers] - Map of enrolled speakers for color lookup
   * @param {Object} [speakerStats] - Per-speaker statistics for enhanced display
   * @param {Array} [hypothesisHistory] - History of hypothesis changes
   */
  render(hypothesis, enrolledSpeakers = [], speakerStats = {}, hypothesisHistory = []) {
    const listEl = this.getListElement();
    const statusEl = this.getStatusElement();

    if (!listEl || !statusEl) return;

    // Check if hypothesis version changed
    const versionChanged = hypothesis.version !== this.previousVersion;

    // Render participant list with enhanced stats
    this.renderParticipants(listEl, hypothesis.participants, enrolledSpeakers, versionChanged, speakerStats);

    // Render status with version info
    this.renderStatus(statusEl, hypothesis);

    // Render hypothesis history if available
    this.renderHistory(listEl, hypothesisHistory);

    // Update tracking
    this.previousVersion = hypothesis.version;
    this.previousParticipants = hypothesis.participants.map(p => p.speakerName);
  }

  /**
   * Render participant list
   */
  renderParticipants(listEl, participants, enrolledSpeakers, animate = false, speakerStats = {}) {
    if (participants.length === 0) {
      listEl.innerHTML = '<div class="participants-empty">No participants identified yet</div>';
      return;
    }

    // Build enrolled speaker index for color lookup
    const enrolledIndex = new Map();
    enrolledSpeakers.forEach((speaker, idx) => {
      enrolledIndex.set(speaker.name, idx);
    });

    const html = participants.map((participant, idx) => {
      // Get color from enrolled index if available
      const colorIdx = enrolledIndex.has(participant.speakerName)
        ? enrolledIndex.get(participant.speakerName)
        : idx;
      const color = this.colors[colorIdx % this.colors.length];

      // Determine if this is a new participant (for animation)
      const isNew = !this.previousParticipants.includes(participant.speakerName);
      const animClass = animate && isNew ? ' participant-new' : '';

      // Confidence as percentage
      const confidencePct = Math.round(participant.confidence * 100);

      // Get enhanced stats for this participant
      const stats = speakerStats[participant.speakerName];
      let enhancedStatsHtml = '';

      if (stats) {
        // Trend indicator
        const trendIcon = stats.trend === 'improving' ? '↑' :
                          stats.trend === 'declining' ? '↓' : '→';
        const trendClass = stats.trend;

        // Similarity range
        const minPct = stats.minSimilarity !== null ? Math.round(stats.minSimilarity * 100) : '-';
        const maxPct = stats.maxSimilarity !== null ? Math.round(stats.maxSimilarity * 100) : '-';

        // Build sparkline from time series (last 8 data points)
        let sparklineHtml = '';
        if (stats.timeSeries && stats.timeSeries.length > 1) {
          const recentData = stats.timeSeries.slice(-8);
          const bars = recentData.map(point => {
            // Scale similarity (0.5-1.0 range) to bar height (20-100%)
            const normalizedHeight = Math.max(0, Math.min(100, (point.similarity - 0.5) * 200));
            const barClass = point.rank === 1 ? 'sparkline-bar-best' : 'sparkline-bar-second';
            return `<div class="sparkline-bar ${barClass}" style="height: ${normalizedHeight}%" title="${Math.round(point.similarity * 100)}%"></div>`;
          }).join('');
          sparklineHtml = `<div class="sparkline" title="Recent similarity values">${bars}</div>`;
        }

        enhancedStatsHtml = `
          <div class="participant-extended-stats">
            <span class="stat-item stat-split" title="Best match / Runner-up count">
              ${stats.bestMatchCount} best / ${stats.runnerUpCount} 2nd
            </span>
            <span class="stat-item stat-range" title="Similarity range (min-max)">
              ${minPct}-${maxPct}%
            </span>
            ${sparklineHtml}
            <span class="stat-trend ${trendClass}" title="Trend: ${stats.trend}">
              ${trendIcon}
            </span>
          </div>
        `;
      }

      return `
        <div class="participant-item${animClass}" style="--participant-color: ${color}">
          <div class="participant-header">
            <span class="participant-color" style="background-color: ${color}"></span>
            <span class="participant-name">${this.escapeHtml(participant.speakerName)}</span>
            <span class="participant-confidence">${confidencePct}%</span>
          </div>
          <div class="participant-bar-container">
            <div class="participant-bar" style="width: ${confidencePct}%; background-color: ${color}"></div>
          </div>
          <div class="participant-stats">
            <span class="participant-segments">${participant.segmentCount} segment${participant.segmentCount !== 1 ? 's' : ''}</span>
          </div>
          ${enhancedStatsHtml}
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;
  }

  /**
   * Render status message with hypothesis version
   */
  renderStatus(statusEl, hypothesis) {
    let statusText;
    let statusClass = 'participants-status';

    const versionBadge = hypothesis.version > 0 ? `<span class="hypothesis-version">v${hypothesis.version}</span>` : '';

    if (hypothesis.isForming) {
      const remaining = hypothesis.segmentsUntilHypothesis;
      statusText = `${versionBadge}<span class="status-text">Building... (${remaining} more segment${remaining !== 1 ? 's' : ''})</span>`;
      statusClass += ' status-building';
    } else if (hypothesis.participants.length === 0) {
      statusText = `${versionBadge}<span class="status-text">No confident matches</span>`;
      statusClass += ' status-waiting';
    } else {
      const count = hypothesis.participants.length;
      statusText = `${versionBadge}<span class="status-text">${count} participant${count !== 1 ? 's' : ''} (Active)</span>`;
      statusClass += ' status-ready';
    }

    statusEl.className = statusClass;
    statusEl.innerHTML = statusText;
  }

  /**
   * Render empty/initial state
   */
  renderEmpty() {
    const listEl = this.getListElement();
    const statusEl = this.getStatusElement();

    if (listEl) {
      listEl.innerHTML = '<div class="participants-empty">Start recording to identify participants</div>';
    }

    if (statusEl) {
      statusEl.className = 'participants-status status-idle';
      statusEl.textContent = 'Waiting for audio...';
    }
  }

  /**
   * Show recording state
   */
  renderRecording() {
    const statusEl = this.getStatusElement();
    if (statusEl) {
      statusEl.className = 'participants-status status-building';
      statusEl.textContent = 'Listening for speech...';
    }
  }

  /**
   * Render hypothesis change history (Feature 9)
   */
  renderHistory(listEl, hypothesisHistory) {
    // Find or create history container
    let historyEl = listEl.parentElement?.querySelector('.hypothesis-history');

    if (!hypothesisHistory || hypothesisHistory.length === 0) {
      if (historyEl) historyEl.remove();
      return;
    }

    if (!historyEl) {
      historyEl = document.createElement('details');
      historyEl.className = 'hypothesis-history';
      listEl.parentElement?.appendChild(historyEl);
    }

    // Format history entries (most recent first)
    const entries = [...hypothesisHistory].reverse().slice(0, 5).map(entry => {
      const changes = [];
      if (entry.changes.added.length > 0) {
        changes.push(`<span class="history-added">+${entry.changes.added.join(', ')}</span>`);
      }
      if (entry.changes.removed.length > 0) {
        changes.push(`<span class="history-removed">-${entry.changes.removed.join(', ')}</span>`);
      }
      const changeText = changes.length > 0 ? changes.join(' ') : 'No changes';

      return `
        <div class="history-entry">
          <span class="history-version">v${entry.version}</span>
          <span class="history-changes">${changeText}</span>
          <span class="history-segment">@ seg ${entry.totalSegments}</span>
        </div>
      `;
    }).join('');

    historyEl.innerHTML = `
      <summary class="history-summary">
        <span class="history-icon">📋</span> History (${hypothesisHistory.length} change${hypothesisHistory.length !== 1 ? 's' : ''})
      </summary>
      <div class="history-list">${entries}</div>
    `;
  }

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Reset panel state
   */
  reset() {
    this.previousVersion = -1;
    this.previousParticipants = [];
    this.renderEmpty();
  }
}

export default ParticipantsPanel;
