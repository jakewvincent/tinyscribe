/**
 * Portal-based tooltip web component
 * Renders tooltips at document body level to avoid overflow clipping.
 * Auto-positions based on viewport quadrant.
 *
 * Usage:
 *   <app-tooltip text="Simple text">trigger element</app-tooltip>
 *   <app-tooltip><span slot="content">HTML content</span>trigger element</app-tooltip>
 *
 * Attributes:
 *   text - Simple text content (alternative to slot)
 *   position - Override auto-positioning: auto|up|down|left|right|up-left|up-right|down-left|down-right
 *   delay - Show delay in ms (default: 150)
 *   max-width - Maximum width (default: 220px)
 */
class AppTooltip extends HTMLElement {
  constructor() {
    super();
    this._portal = null;
    this._showTimeout = null;
    this._visible = false;
    this._boundShow = this._show.bind(this);
    this._boundHide = this._hide.bind(this);
    this._boundReposition = this._reposition.bind(this);
  }

  connectedCallback() {
    // Create portal element
    this._portal = document.createElement('div');
    this._portal.className = 'tooltip-portal';
    this._portal.setAttribute('role', 'tooltip');
    this._portal.setAttribute('aria-hidden', 'true');

    // Set max-width if specified
    const maxWidth = this.getAttribute('max-width') || '220px';
    this._portal.style.maxWidth = maxWidth;

    // Populate content from slot or text attribute
    this._updateContent();

    // Append to body
    document.body.appendChild(this._portal);

    // Event listeners
    this.addEventListener('mouseenter', this._boundShow);
    this.addEventListener('mouseleave', this._boundHide);
    this.addEventListener('focus', this._boundShow, true);
    this.addEventListener('blur', this._boundHide, true);
    this.addEventListener('touchstart', this._onTouchStart.bind(this));

    // Reposition on scroll/resize
    window.addEventListener('scroll', this._boundReposition, true);
    window.addEventListener('resize', this._boundReposition);
  }

  disconnectedCallback() {
    this._hide();
    if (this._portal && this._portal.parentNode) {
      this._portal.parentNode.removeChild(this._portal);
    }
    this.removeEventListener('mouseenter', this._boundShow);
    this.removeEventListener('mouseleave', this._boundHide);
    this.removeEventListener('focus', this._boundShow, true);
    this.removeEventListener('blur', this._boundHide, true);
    window.removeEventListener('scroll', this._boundReposition, true);
    window.removeEventListener('resize', this._boundReposition);
  }

  _updateContent() {
    const slot = this.querySelector('[slot="content"]');
    if (slot) {
      this._portal.innerHTML = slot.innerHTML;
    } else {
      this._portal.textContent = this.getAttribute('text') || '';
    }
  }

  _show() {
    const delay = parseInt(this.getAttribute('delay') || '150', 10);
    clearTimeout(this._showTimeout);
    this._showTimeout = setTimeout(() => {
      this._reposition();
      this._portal.classList.add('visible');
      this._portal.setAttribute('aria-hidden', 'false');
      this._visible = true;
    }, delay);
  }

  _hide() {
    clearTimeout(this._showTimeout);
    this._portal.classList.remove('visible');
    this._portal.setAttribute('aria-hidden', 'true');
    this._visible = false;
  }

  _onTouchStart(e) {
    if (this._visible) {
      this._hide();
    } else {
      this._show();
      // Hide on next touch outside
      const hideOnOutsideTouch = (evt) => {
        if (!this.contains(evt.target) && !this._portal.contains(evt.target)) {
          this._hide();
          document.removeEventListener('touchstart', hideOnOutsideTouch);
        }
      };
      setTimeout(() => {
        document.addEventListener('touchstart', hideOnOutsideTouch);
      }, 0);
    }
  }

  _reposition() {
    if (!this._portal) return;

    const rect = this.getBoundingClientRect();
    const position = this._getOptimalPosition(rect);

    // Store position for CSS arrow styling
    this._portal.setAttribute('data-position', position);

    // Calculate portal position
    const { top, left, arrowOffset } = this._calculatePosition(rect, position);
    this._portal.style.top = `${top}px`;
    this._portal.style.left = `${left}px`;

    // Set arrow offset as CSS custom property (for when tooltip is clamped)
    if (arrowOffset !== undefined) {
      this._portal.style.setProperty('--arrow-offset', `${arrowOffset}px`);
    } else {
      this._portal.style.removeProperty('--arrow-offset');
    }
  }

  _getOptimalPosition(rect) {
    // Allow manual override
    const manualPosition = this.getAttribute('position');
    if (manualPosition && manualPosition !== 'auto') {
      return manualPosition;
    }

    // Calculate viewport quadrant (20% edge threshold)
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const edgeX = vw * 0.2;
    const edgeY = vh * 0.2;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const nearLeft = centerX < edgeX;
    const nearRight = centerX > vw - edgeX;
    const nearTop = centerY < edgeY;
    const nearBottom = centerY > vh - edgeY;

    // Determine optimal position based on quadrant
    if (nearTop && nearLeft) return 'down-right';
    if (nearTop && nearRight) return 'down-left';
    if (nearTop) return 'down';
    if (nearBottom && nearLeft) return 'up-right';
    if (nearBottom && nearRight) return 'up-left';
    if (nearBottom) return 'up';
    if (nearLeft) return 'right';
    if (nearRight) return 'left';

    // Default: show above
    return 'up';
  }

  _calculatePosition(rect, position) {
    const gap = 8; // 0.5rem
    const arrowSize = 5;

    // Get portal dimensions (render off-screen first if needed)
    this._portal.style.visibility = 'hidden';
    this._portal.style.display = 'block';
    const portalRect = this._portal.getBoundingClientRect();
    this._portal.style.visibility = '';

    let top, left;
    let arrowOffset; // Offset from center when tooltip is clamped

    switch (position) {
      case 'up':
        top = rect.top - portalRect.height - gap - arrowSize;
        left = rect.left + rect.width / 2 - portalRect.width / 2;
        break;
      case 'down':
        top = rect.bottom + gap + arrowSize;
        left = rect.left + rect.width / 2 - portalRect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - portalRect.height / 2;
        left = rect.left - portalRect.width - gap - arrowSize;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - portalRect.height / 2;
        left = rect.right + gap + arrowSize;
        break;
      case 'up-left':
        top = rect.top - portalRect.height - gap - arrowSize;
        // Position so arrow (14px from right edge) points at trigger center
        left = rect.left + rect.width / 2 - portalRect.width + 14;
        break;
      case 'up-right':
        top = rect.top - portalRect.height - gap - arrowSize;
        // Position so arrow (14px from left edge) points at trigger center
        left = rect.left + rect.width / 2 - 14;
        break;
      case 'down-left':
        top = rect.bottom + gap + arrowSize;
        // Position so arrow (14px from right edge) points at trigger center
        left = rect.left + rect.width / 2 - portalRect.width + 14;
        break;
      case 'down-right':
        top = rect.bottom + gap + arrowSize;
        // Position so arrow (14px from left edge) points at trigger center
        left = rect.left + rect.width / 2 - 14;
        break;
      default:
        top = rect.top - portalRect.height - gap - arrowSize;
        left = rect.left + rect.width / 2 - portalRect.width / 2;
    }

    // Clamp to viewport with padding
    const padding = 8;
    const originalLeft = left;
    left = Math.max(padding, Math.min(left, window.innerWidth - portalRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - portalRect.height - padding));

    // Calculate arrow offset for centered up/down positions when clamped
    // Corner positions (up-left, up-right, down-left, down-right) don't need dynamic offset
    // because the tooltip body is positioned to align the fixed arrow with trigger center
    if (position === 'up' || position === 'down') {
      if (left !== originalLeft) {
        const triggerCenterX = rect.left + rect.width / 2;
        arrowOffset = triggerCenterX - left - portalRect.width / 2;
        // Clamp so arrow stays in safe zone (14px from edges)
        const safeZone = 14;
        const maxOffset = portalRect.width / 2 - safeZone;
        arrowOffset = Math.max(-maxOffset, Math.min(maxOffset, arrowOffset));
      }
    }

    return { top, left, arrowOffset };
  }
}

customElements.define('app-tooltip', AppTooltip);

export default AppTooltip;
