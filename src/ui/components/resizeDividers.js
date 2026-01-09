/**
 * ResizeDividers
 * Handles drag-to-resize interactions for panel dividers.
 *
 * Follows the UI component pattern (accepts DOM elements, config options).
 * Communicates state changes via CustomEvents for Alpine integration.
 */

export class ResizeDividers {
  /**
   * @param {Object} options
   * @param {Object} [options.horizontal] - Horizontal divider config (workspace)
   * @param {HTMLElement} [options.horizontal.dividerEl] - The divider element
   * @param {HTMLElement} [options.horizontal.topPanel] - Top panel element
   * @param {HTMLElement} [options.horizontal.bottomPanel] - Bottom panel element
   * @param {HTMLElement} [options.horizontal.container] - Container element
   * @param {Object} [options.vertical] - Vertical divider config (sidebar)
   * @param {HTMLElement} [options.vertical.dividerEl] - The divider element
   * @param {HTMLElement} [options.vertical.sidebar] - Sidebar element
   */
  constructor(options = {}) {
    this.horizontal = options.horizontal || null;
    this.vertical = options.vertical || null;

    // Drag state
    this.isDragging = false;
    this.activeType = null; // 'horizontal' | 'vertical'
    this.startY = 0;
    this.startX = 0;
    this.startSize = 0;

    // Constraints
    this.minPanelSize = 100; // px
    this.minSidebarWidth = 200; // px
    this.maxSidebarWidth = 600; // px

    // Bound handlers for cleanup
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
  }

  /**
   * Initialize event listeners
   */
  init() {
    // Attach mousedown to horizontal divider
    if (this.horizontal?.dividerEl) {
      this.horizontal.dividerEl.addEventListener('mousedown', (e) => {
        this.handleMouseDown(e, 'horizontal');
      });
    }

    // Attach mousedown to vertical divider
    if (this.vertical?.dividerEl) {
      this.vertical.dividerEl.addEventListener('mousedown', (e) => {
        this.handleMouseDown(e, 'vertical');
      });
    }

    // Global listeners for mousemove/mouseup (attached once)
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
  }

  /**
   * Handle mousedown on a divider
   * @param {MouseEvent} e
   * @param {'horizontal'|'vertical'} type
   */
  handleMouseDown(e, type) {
    e.preventDefault();
    this.isDragging = true;
    this.activeType = type;

    if (type === 'horizontal') {
      this.startY = e.clientY;
      this.startSize = this.horizontal.topPanel.getBoundingClientRect().height;
    } else {
      this.startX = e.clientX;
      this.startSize = this.vertical.sidebar.getBoundingClientRect().width;
    }

    // Add class for cursor feedback and prevent text selection
    document.body.classList.add('resizing');
    document.body.style.cursor = type === 'horizontal' ? 'ns-resize' : 'ew-resize';
  }

  /**
   * Handle mousemove during drag
   * @param {MouseEvent} e
   */
  handleMouseMove(e) {
    if (!this.isDragging) return;

    if (this.activeType === 'horizontal') {
      const delta = e.clientY - this.startY;
      const containerHeight = this.horizontal.container.getBoundingClientRect().height;
      const dividerHeight = 4; // Match CSS

      let newTopHeight = this.startSize + delta;

      // Constrain to min panel size
      newTopHeight = Math.max(this.minPanelSize, newTopHeight);
      newTopHeight = Math.min(
        containerHeight - this.minPanelSize - dividerHeight,
        newTopHeight
      );

      // Apply as percentage for flex
      const percent = (newTopHeight / containerHeight) * 100;
      this.horizontal.topPanel.style.flex = `0 0 ${percent}%`;
    } else if (this.activeType === 'vertical') {
      // Dragging left increases width (divider is on left edge of sidebar)
      const delta = this.startX - e.clientX;
      let newWidth = this.startSize + delta;

      // Constrain
      newWidth = Math.max(this.minSidebarWidth, newWidth);
      newWidth = Math.min(this.maxSidebarWidth, newWidth);

      // Apply via CSS variable
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    }
  }

  /**
   * Handle mouseup to end drag
   */
  handleMouseUp() {
    if (!this.isDragging) return;

    // Emit resize-complete event with final values for persistence
    if (this.activeType === 'horizontal') {
      const containerHeight = this.horizontal.container.getBoundingClientRect().height;
      const topHeight = this.horizontal.topPanel.getBoundingClientRect().height;
      const percent = (topHeight / containerHeight) * 100;

      window.dispatchEvent(
        new CustomEvent('workspace-resize-complete', {
          detail: { topPercent: percent },
        })
      );
    } else if (this.activeType === 'vertical') {
      const sidebarWidth = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
      );

      window.dispatchEvent(
        new CustomEvent('sidebar-resize-complete', {
          detail: { width: sidebarWidth },
        })
      );
    }

    // Reset drag state
    this.isDragging = false;
    this.activeType = null;
    document.body.classList.remove('resizing');
    document.body.style.cursor = '';
  }

  /**
   * Restore saved sizes
   * @param {Object} savedSizes
   * @param {number} [savedSizes.workspaceTopPercent] - Top panel percentage (0-100)
   * @param {number} [savedSizes.sidebarWidth] - Sidebar width in pixels
   */
  restore(savedSizes) {
    if (savedSizes.workspaceTopPercent != null && this.horizontal?.topPanel) {
      this.horizontal.topPanel.style.flex = `0 0 ${savedSizes.workspaceTopPercent}%`;
    }
    if (savedSizes.sidebarWidth != null && this.vertical) {
      document.documentElement.style.setProperty(
        '--sidebar-width',
        `${savedSizes.sidebarWidth}px`
      );
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }
}

export default ResizeDividers;
