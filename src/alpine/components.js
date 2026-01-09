/**
 * Alpine.js Components
 * Register all Alpine components before Alpine starts
 */

document.addEventListener('alpine:init', () => {
  /**
   * Collapsible panel component with persistence
   * Usage: x-data="panel('panel-name', true)"
   * @param {string} name - Unique panel identifier for persistence
   * @param {boolean} defaultExpanded - Initial expanded state
   */
  Alpine.data('panel', (name, defaultExpanded = true) => ({
    expanded: Alpine.$persist(defaultExpanded).as(`panel-${name}`),

    toggle() {
      this.expanded = !this.expanded;
    },

    // Listen for programmatic collapse/expand from app.js
    init() {
      window.addEventListener('panel-collapse', (e) => {
        if (e.detail.panel === name) {
          this.expanded = false;
        }
      });
      window.addEventListener('panel-expand', (e) => {
        if (e.detail.panel === name) {
          this.expanded = true;
        }
      });
    },
  }));

  /**
   * Status bar component
   * Displays app status, metrics, and processing state
   */
  Alpine.data('statusBar', () => ({
    status: 'ready',
    statusText: 'Ready',
    metrics: { asr: '-', embed: '-', total: '-' },
    bufferPercent: 0,
    chunkStatus: 'Idle',
    chunkSlots: [false, false, false, false, false], // slot states

    init() {
      // Listen for status updates from app.js
      window.addEventListener('status-update', (e) => {
        const { status, text } = e.detail;
        this.status = status;
        this.statusText = text;
      });

      window.addEventListener('metrics-update', (e) => {
        this.metrics = e.detail;
      });

      window.addEventListener('buffer-update', (e) => {
        this.bufferPercent = e.detail.percent;
      });

      window.addEventListener('chunk-queue-update', (e) => {
        this.chunkStatus = e.detail.status;
        this.chunkSlots = e.detail.slots;
      });
    },
  }));

  /**
   * Recording controls component
   * Manages recording button state and actions
   */
  Alpine.data('recordingControls', () => ({
    isRecording: false,
    modelLoaded: false,
    hasTranscript: false,

    init() {
      window.addEventListener('model-loaded', () => {
        this.modelLoaded = true;
      });

      window.addEventListener('recording-state', (e) => {
        this.isRecording = e.detail.recording;
      });

      window.addEventListener('transcript-state', (e) => {
        this.hasTranscript = e.detail.hasContent;
      });
    },

    toggleRecording() {
      window.dispatchEvent(new CustomEvent('toggle-recording'));
    },

    uploadAudio() {
      window.dispatchEvent(new CustomEvent('upload-audio'));
    },

    clearTranscript() {
      window.dispatchEvent(new CustomEvent('clear-transcript'));
    },
  }));

  /**
   * Phrase stats component
   * Displays last phrase details with speaker info
   */
  Alpine.data('phraseStats', () => ({
    phrase: {
      text: 'No phrases yet',
      speaker: '-',
      similarity: '-',
      runnerUp: '-',
      margin: '-',
      marginValue: null,
      duration: '-',
      type: '-',
    },

    get phrasePreview() {
      const text = this.phrase.text || 'No phrases yet';
      return text.length > 80 ? text.substring(0, 80) + '...' : text;
    },

    get marginClass() {
      const margin = this.phrase.marginValue;
      if (margin >= 0.15) return 'confidence-high';
      if (margin >= 0.05) return 'confidence-medium';
      if (margin > 0) return 'confidence-low';
      return '';
    },

    init() {
      window.addEventListener('phrase-update', (e) => {
        this.phrase = e.detail;
      });

      window.addEventListener('phrase-reset', () => {
        this.phrase = {
          text: 'No phrases yet',
          speaker: '-',
          similarity: '-',
          runnerUp: '-',
          margin: '-',
          marginValue: null,
          duration: '-',
          type: '-',
        };
      });
    },
  }));

  /**
   * Enrollment content component
   * Manages enrollment sidebar UI: intro -> complete states
   * (Modal handled separately in app.js)
   */
  Alpine.data('enrollmentContent', () => ({
    state: 'intro', // 'intro' | 'complete'
    speakerName: '',
    enrollments: [],
    modelLoaded: false,
    statusMessage: '',
    statusError: false,

    get enrolledCountText() {
      const count = this.enrollments.length;
      return `${count} speaker${count !== 1 ? 's' : ''} enrolled`;
    },

    init() {
      // Listen for model loaded
      window.addEventListener('model-loaded', () => {
        this.modelLoaded = true;
      });

      // Listen for enrollment list updates from app.js
      window.addEventListener('enrollments-updated', (e) => {
        this.enrollments = e.detail.enrollments;
        if (this.enrollments.length > 0 && this.state === 'intro') {
          this.state = 'complete';
        } else if (this.enrollments.length === 0) {
          this.state = 'intro';
        }
      });

      // Listen for state changes from app.js (e.g., after modal closes)
      window.addEventListener('enrollment-state-change', (e) => {
        this.state = e.detail.state;
        if (e.detail.speakerName !== undefined) {
          this.speakerName = e.detail.speakerName;
        }
      });

      // Listen for status updates
      window.addEventListener('enrollment-status', (e) => {
        this.statusMessage = e.detail.message;
        this.statusError = e.detail.isError || false;
      });
    },

    startEnrollment() {
      // Dispatch to app.js which opens the modal
      window.dispatchEvent(
        new CustomEvent('enrollment-start', {
          detail: { name: this.speakerName },
        })
      );
    },

    skip() {
      this.state = 'complete';
    },

    addNewSpeaker() {
      this.speakerName = '';
      this.state = 'intro';
    },

    removeEnrollment(id) {
      window.dispatchEvent(
        new CustomEvent('enrollment-remove', {
          detail: { id },
        })
      );
    },

    clearAll() {
      window.dispatchEvent(new CustomEvent('enrollment-clear-all'));
    },
  }));

  /**
   * Segment Comparison Mode component (Feature 7)
   * Allows comparing embeddings between two transcript segments
   */
  Alpine.data('comparisonMode', () => ({
    enabled: false,
    result: null,

    init() {
      // Listen for mode changes
      window.addEventListener('comparison-mode-changed', (e) => {
        this.enabled = e.detail.enabled;
        if (!this.enabled) {
          this.result = null;
        }
      });

      // Listen for comparison results
      window.addEventListener('comparison-result', (e) => {
        this.result = e.detail;
      });
    },

    toggle() {
      if (window.app) {
        window.app.toggleComparisonMode();
      }
    },

    get similarityPercent() {
      return this.result?.similarity ? Math.round(this.result.similarity * 100) : null;
    },

    get similarityClass() {
      if (!this.result?.similarity) return '';
      if (this.result.similarity >= 0.75) return 'similarity-high';
      if (this.result.similarity >= 0.5) return 'similarity-medium';
      return 'similarity-low';
    },

    get verdictText() {
      if (!this.result) return '';
      if (this.result.error) return this.result.error;
      if (this.result.sameSpeakerLikely && this.result.sameSpeakerActual) {
        return 'Same speaker (confirmed)';
      } else if (this.result.sameSpeakerLikely && !this.result.sameSpeakerActual) {
        return 'Likely same speaker (mismatch!)';
      } else if (!this.result.sameSpeakerLikely && this.result.sameSpeakerActual) {
        return 'Different embedding, same assigned speaker';
      } else {
        return 'Different speakers';
      }
    },

    get verdictClass() {
      if (!this.result || this.result.error) return 'verdict-error';
      if (this.result.sameSpeakerLikely === this.result.sameSpeakerActual) {
        return 'verdict-match';
      }
      return 'verdict-mismatch';
    },
  }));
});
