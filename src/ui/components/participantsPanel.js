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
   */
  render(hypothesis, enrolledSpeakers = []) {
    const listEl = this.getListElement();
    const statusEl = this.getStatusElement();

    if (!listEl || !statusEl) return;

    // Check if hypothesis version changed
    const versionChanged = hypothesis.version !== this.previousVersion;

    // Render participant list
    this.renderParticipants(listEl, hypothesis.participants, enrolledSpeakers, versionChanged);

    // Render status
    this.renderStatus(statusEl, hypothesis);

    // Update tracking
    this.previousVersion = hypothesis.version;
    this.previousParticipants = hypothesis.participants.map(p => p.speakerName);
  }

  /**
   * Render participant list
   */
  renderParticipants(listEl, participants, enrolledSpeakers, animate = false) {
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
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;
  }

  /**
   * Render status message
   */
  renderStatus(statusEl, hypothesis) {
    let statusText;
    let statusClass = 'participants-status';

    if (hypothesis.isForming) {
      const remaining = hypothesis.segmentsUntilHypothesis;
      statusText = `Building hypothesis... (${remaining} more segment${remaining !== 1 ? 's' : ''} needed)`;
      statusClass += ' status-building';
    } else if (hypothesis.participants.length === 0) {
      statusText = 'No confident matches yet';
      statusClass += ' status-waiting';
    } else {
      const count = hypothesis.participants.length;
      statusText = `${count} participant${count !== 1 ? 's' : ''} identified`;
      statusClass += ' status-ready';
    }

    statusEl.className = statusClass;
    statusEl.textContent = statusText;
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
