/**
 * Unit tests for LocalStorageAdapter
 *
 * Uses a custom localStorage mock since jsdom's implementation can be unreliable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalStorageAdapter } from '../../../src/storage/localStorage/localStorageAdapter.js';

// Create a proper localStorage mock
function createLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i) => Object.keys(store)[i] || null),
  };
}

describe('LocalStorageAdapter', () => {
  let mockLocalStorage;

  beforeEach(() => {
    // Set up mock
    mockLocalStorage = createLocalStorageMock();
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isAvailable', () => {
    it('should return true when localStorage is available', () => {
      expect(LocalStorageAdapter.isAvailable()).toBe(true);
    });
  });

  describe('getString / setString', () => {
    it('should store and retrieve string values', () => {
      LocalStorageAdapter.setString('test-key', 'test-value');
      expect(LocalStorageAdapter.getString('test-key')).toBe('test-value');
    });

    it('should return null for non-existent key', () => {
      expect(LocalStorageAdapter.getString('non-existent')).toBeNull();
    });

    it('should return true on successful set', () => {
      expect(LocalStorageAdapter.setString('key', 'value')).toBe(true);
    });

    it('should overwrite existing values', () => {
      LocalStorageAdapter.setString('key', 'value1');
      LocalStorageAdapter.setString('key', 'value2');
      expect(LocalStorageAdapter.getString('key')).toBe('value2');
    });
  });

  describe('getJSON / setJSON', () => {
    it('should store and retrieve objects', () => {
      const obj = { name: 'test', count: 42 };
      LocalStorageAdapter.setJSON('obj-key', obj);
      expect(LocalStorageAdapter.getJSON('obj-key')).toEqual(obj);
    });

    it('should store and retrieve arrays', () => {
      const arr = [1, 2, 3, { nested: true }];
      LocalStorageAdapter.setJSON('arr-key', arr);
      expect(LocalStorageAdapter.getJSON('arr-key')).toEqual(arr);
    });

    it('should return default value for non-existent key', () => {
      expect(LocalStorageAdapter.getJSON('missing')).toBeNull();
      expect(LocalStorageAdapter.getJSON('missing', [])).toEqual([]);
      expect(LocalStorageAdapter.getJSON('missing', { default: true })).toEqual({ default: true });
    });

    it('should return default value for invalid JSON', () => {
      localStorage.setItem('bad-json', 'not valid json {');
      expect(LocalStorageAdapter.getJSON('bad-json', 'fallback')).toBe('fallback');
    });

    it('should handle null values', () => {
      LocalStorageAdapter.setJSON('null-key', null);
      expect(LocalStorageAdapter.getJSON('null-key', 'default')).toBeNull();
    });

    it('should handle primitive values', () => {
      LocalStorageAdapter.setJSON('number', 42);
      LocalStorageAdapter.setJSON('string', 'hello');
      LocalStorageAdapter.setJSON('bool', true);

      expect(LocalStorageAdapter.getJSON('number')).toBe(42);
      expect(LocalStorageAdapter.getJSON('string')).toBe('hello');
      expect(LocalStorageAdapter.getJSON('bool')).toBe(true);
    });
  });

  describe('getBoolean / setBoolean', () => {
    it('should store and retrieve true', () => {
      LocalStorageAdapter.setBoolean('bool-key', true);
      expect(LocalStorageAdapter.getBoolean('bool-key')).toBe(true);
    });

    it('should store and retrieve false', () => {
      LocalStorageAdapter.setBoolean('bool-key', false);
      expect(LocalStorageAdapter.getBoolean('bool-key')).toBe(false);
    });

    it('should return default for non-existent key', () => {
      expect(LocalStorageAdapter.getBoolean('missing')).toBe(false);
      expect(LocalStorageAdapter.getBoolean('missing', true)).toBe(true);
    });

    it('should store as string "true" or "false"', () => {
      LocalStorageAdapter.setBoolean('key', true);
      expect(localStorage.getItem('key')).toBe('true');

      LocalStorageAdapter.setBoolean('key', false);
      expect(localStorage.getItem('key')).toBe('false');
    });
  });

  describe('remove', () => {
    it('should remove existing key', () => {
      LocalStorageAdapter.setString('to-remove', 'value');
      expect(LocalStorageAdapter.has('to-remove')).toBe(true);

      LocalStorageAdapter.remove('to-remove');
      expect(LocalStorageAdapter.has('to-remove')).toBe(false);
    });

    it('should return true even for non-existent key', () => {
      expect(LocalStorageAdapter.remove('non-existent')).toBe(true);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      LocalStorageAdapter.setString('exists', 'value');
      expect(LocalStorageAdapter.has('exists')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(LocalStorageAdapter.has('does-not-exist')).toBe(false);
    });

    it('should return true for key with empty string value', () => {
      LocalStorageAdapter.setString('empty', '');
      expect(LocalStorageAdapter.has('empty')).toBe(true);
    });
  });

  describe('integration: enrollment-like data', () => {
    it('should handle complex enrollment data structure', () => {
      const enrollments = [
        {
          id: '1',
          name: 'Alice',
          centroid: new Array(512).fill(0.1),
          colorIndex: 0,
          timestamp: Date.now(),
        },
        {
          id: '2',
          name: 'Bob',
          centroid: new Array(512).fill(0.2),
          colorIndex: 1,
          timestamp: Date.now(),
        },
      ];

      LocalStorageAdapter.setJSON('enrollments', enrollments);
      const retrieved = LocalStorageAdapter.getJSON('enrollments');

      expect(retrieved.length).toBe(2);
      expect(retrieved[0].name).toBe('Alice');
      expect(retrieved[1].name).toBe('Bob');
      expect(retrieved[0].centroid.length).toBe(512);
    });
  });
});
