/**
 * Speaker Visualizer
 * Renders speaker embeddings as 2D scatter plot using PCA projection
 */

import { PCAProjector } from './pcaProjector.js';

const SPEAKER_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
];

export class SpeakerVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.pca = new PCAProjector();
    this.padding = 50;
    this.dotRadius = 10;
    this.dpr = window.devicePixelRatio || 1;

    // Set up high-DPI canvas
    if (this.canvas) {
      this.setupCanvas();
    }
  }

  /**
   * Set up canvas for high-DPI displays
   */
  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  /**
   * Get canvas dimensions in CSS pixels
   */
  getCanvasDimensions() {
    return {
      width: this.canvas.width / this.dpr,
      height: this.canvas.height / this.dpr,
    };
  }

  /**
   * Render speakers on 2D scatter plot
   * @param {Array} speakers - From clusterer.getAllSpeakersForVisualization()
   */
  render(speakers) {
    if (!this.ctx) return;

    const { width, height } = this.getCanvasDimensions();

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    if (!speakers || speakers.length === 0) {
      this.renderEmpty();
      return;
    }

    // Project to 2D
    const projected = this.pca.fitTransform(speakers);

    // Find bounds
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // Add some padding to the data bounds
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    minX -= rangeX * 0.1;
    maxX += rangeX * 0.1;
    minY -= rangeY * 0.1;
    maxY += rangeY * 0.1;

    // Draw background grid
    this.drawGrid(width, height);

    // Scale to canvas
    const plotWidth = width - 2 * this.padding;
    const plotHeight = height - 2 * this.padding;
    const scaleX = maxX === minX ? 1 : plotWidth / (maxX - minX);
    const scaleY = maxY === minY ? 1 : plotHeight / (maxY - minY);

    // Draw each speaker
    for (const p of projected) {
      let cx, cy;

      if (projected.length === 1) {
        // Single point - center it
        cx = width / 2;
        cy = height / 2;
      } else {
        cx = this.padding + (p.x - minX) * scaleX;
        cy = this.padding + (maxY - p.y) * scaleY; // Flip Y for canvas coords
      }

      this.drawSpeaker(cx, cy, p);
    }

    // Draw legend
    this.drawLegend(projected, width, height);
  }

  /**
   * Draw background grid
   */
  drawGrid(width, height) {
    this.ctx.strokeStyle = '#e2e8f0';
    this.ctx.lineWidth = 1;

    // Vertical lines
    for (let x = this.padding; x <= width - this.padding; x += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.padding);
      this.ctx.lineTo(x, height - this.padding);
      this.ctx.stroke();
    }

    // Horizontal lines
    for (let y = this.padding; y <= height - this.padding; y += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding, y);
      this.ctx.lineTo(width - this.padding, y);
      this.ctx.stroke();
    }
  }

  /**
   * Draw a speaker dot with label
   */
  drawSpeaker(cx, cy, speaker) {
    const color = SPEAKER_COLORS[speaker.colorIndex % SPEAKER_COLORS.length];

    // Draw shadow for depth
    this.ctx.beginPath();
    this.ctx.arc(cx + 2, cy + 2, this.dotRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    this.ctx.fill();

    // Draw dot
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, this.dotRadius, 0, Math.PI * 2);

    if (speaker.enrolled) {
      // Filled dot for enrolled speakers
      this.ctx.fillStyle = color;
      this.ctx.fill();
      this.ctx.strokeStyle = '#1e293b';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    } else {
      // Hollow dot for discovered speakers
      this.ctx.fillStyle = '#f8fafc';
      this.ctx.fill();
      this.ctx.strokeStyle = '#94a3b8';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    // Draw label
    this.ctx.fillStyle = '#1e293b';
    this.ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';

    // Truncate long names
    let name = speaker.name;
    if (name.length > 12) {
      name = name.substring(0, 10) + '...';
    }

    this.ctx.fillText(name, cx, cy - this.dotRadius - 4);
  }

  /**
   * Draw legend in bottom corner
   */
  drawLegend(speakers, width, height) {
    const enrolled = speakers.filter((s) => s.enrolled);
    const discovered = speakers.filter((s) => !s.enrolled);

    this.ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';

    let y = height - 15;
    let x = 10;

    // Enrolled count
    if (enrolled.length > 0) {
      // Draw filled circle
      this.ctx.beginPath();
      this.ctx.arc(x + 5, y, 5, 0, Math.PI * 2);
      this.ctx.fillStyle = SPEAKER_COLORS[0];
      this.ctx.fill();
      this.ctx.strokeStyle = '#1e293b';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      this.ctx.fillStyle = '#64748b';
      this.ctx.fillText(`${enrolled.length} enrolled`, x + 15, y);
      x += 85;
    }

    // Discovered count
    if (discovered.length > 0) {
      // Draw hollow circle
      this.ctx.beginPath();
      this.ctx.arc(x + 5, y, 5, 0, Math.PI * 2);
      this.ctx.fillStyle = '#f8fafc';
      this.ctx.fill();
      this.ctx.strokeStyle = '#94a3b8';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      this.ctx.fillStyle = '#64748b';
      this.ctx.fillText(`${discovered.length} discovered`, x + 15, y);
    }
  }

  /**
   * Render empty state
   */
  renderEmpty() {
    const { width, height } = this.getCanvasDimensions();

    this.ctx.clearRect(0, 0, width, height);

    // Draw placeholder text
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(
      'Enroll speakers to see visualization',
      width / 2,
      height / 2
    );
  }
}
