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
};

export default PreferencesStore;
