/**
 * Preferences Store
 * Typed storage for UI preferences (microphone selection, panel states)
 */

import { LocalStorageAdapter } from '../localStorageAdapter.js';
import { LOCAL_STORAGE_KEYS } from '../../keys.js';

/**
 * @typedef {Object.<string, boolean>} PanelStates
 */

export const PreferencesStore = {
  /**
   * Get selected microphone device ID
   * @returns {string|null}
   */
  getSelectedMicDevice() {
    return LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SELECTED_MIC_DEVICE);
  },

  /**
   * Set selected microphone device ID
   * @param {string} deviceId
   * @returns {boolean} Success
   */
  setSelectedMicDevice(deviceId) {
    return LocalStorageAdapter.setString(LOCAL_STORAGE_KEYS.SELECTED_MIC_DEVICE, deviceId);
  },

  /**
   * Get panel collapse states
   * @returns {PanelStates}
   */
  getPanelStates() {
    return LocalStorageAdapter.getJSON(LOCAL_STORAGE_KEYS.PANEL_STATES, {});
  },

  /**
   * Set panel collapse states
   * @param {PanelStates} states
   * @returns {boolean} Success
   */
  setPanelStates(states) {
    return LocalStorageAdapter.setJSON(LOCAL_STORAGE_KEYS.PANEL_STATES, states);
  },

  /**
   * Get a single panel's collapse state
   * @param {string} panelId
   * @param {boolean} [defaultExpanded=true] - Default if not set
   * @returns {boolean} Whether panel is expanded
   */
  getPanelState(panelId, defaultExpanded = true) {
    const states = this.getPanelStates();
    return panelId in states ? states[panelId] : defaultExpanded;
  },

  /**
   * Update a single panel state
   * @param {string} panelId
   * @param {boolean} expanded
   * @returns {boolean} Success
   */
  setPanelState(panelId, expanded) {
    const states = this.getPanelStates();
    states[panelId] = expanded;
    return this.setPanelStates(states);
  },

  /**
   * Get workspace top panel percentage (0-100)
   * @returns {number} Percentage, default 50
   */
  getWorkspaceTopPercent() {
    const val = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.WORKSPACE_TOP_PERCENT);
    return val ? parseFloat(val) : 50;
  },

  /**
   * Set workspace top panel percentage
   * @param {number} percent
   * @returns {boolean} Success
   */
  setWorkspaceTopPercent(percent) {
    return LocalStorageAdapter.setString(
      LOCAL_STORAGE_KEYS.WORKSPACE_TOP_PERCENT,
      String(percent)
    );
  },

  /**
   * Get sidebar width in pixels
   * @returns {number} Width, default 320
   */
  getSidebarWidth() {
    const val = LocalStorageAdapter.getString(LOCAL_STORAGE_KEYS.SIDEBAR_WIDTH);
    return val ? parseInt(val, 10) : 320;
  },

  /**
   * Set sidebar width
   * @param {number} width
   * @returns {boolean} Success
   */
  setSidebarWidth(width) {
    return LocalStorageAdapter.setString(LOCAL_STORAGE_KEYS.SIDEBAR_WIDTH, String(width));
  },
};

export default PreferencesStore;
