/**
 * IndexedDB Adapter
 * Promise-based wrapper around IndexedDB operations
 */

export class IndexedDBAdapter {
  /**
   * @param {string} dbName - Database name
   * @param {number} version - Schema version
   */
  constructor(dbName, version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  /**
   * Open the database
   * @param {function(IDBDatabase): void} onUpgrade - Schema upgrade callback
   * @returns {Promise<IDBDatabase>}
   */
  async open(onUpgrade) {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        if (onUpgrade) {
          onUpgrade(event.target.result);
        }
      };
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Check if database is open
   * @returns {boolean}
   */
  isOpen() {
    return this.db !== null;
  }

  /**
   * Convert IDBRequest to Promise
   * @param {IDBRequest} request
   * @returns {Promise<any>}
   */
  promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a single record by key
   * @param {string} storeName
   * @param {any} key
   * @returns {Promise<any>}
   */
  async get(storeName, key) {
    const tx = this.db.transaction(storeName, 'readonly');
    return this.promisify(tx.objectStore(storeName).get(key));
  }

  /**
   * Get all records from a store
   * @param {string} storeName
   * @returns {Promise<any[]>}
   */
  async getAll(storeName) {
    const tx = this.db.transaction(storeName, 'readonly');
    return this.promisify(tx.objectStore(storeName).getAll());
  }

  /**
   * Get all records matching an index value
   * @param {string} storeName
   * @param {string} indexName
   * @param {any} value
   * @returns {Promise<any[]>}
   */
  async getAllByIndex(storeName, indexName, value) {
    const tx = this.db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    return this.promisify(index.getAll(value));
  }

  /**
   * Get all keys matching an index value
   * @param {string} storeName
   * @param {string} indexName
   * @param {any} value
   * @returns {Promise<any[]>}
   */
  async getAllKeysByIndex(storeName, indexName, value) {
    const tx = this.db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    return this.promisify(index.getAllKeys(value));
  }

  /**
   * Add a record
   * @param {string} storeName
   * @param {any} record
   * @returns {Promise<any>} The key of the added record
   */
  async add(storeName, record) {
    const tx = this.db.transaction(storeName, 'readwrite');
    return this.promisify(tx.objectStore(storeName).add(record));
  }

  /**
   * Update a record (or insert if not exists)
   * @param {string} storeName
   * @param {any} record
   * @returns {Promise<any>}
   */
  async put(storeName, record) {
    const tx = this.db.transaction(storeName, 'readwrite');
    return this.promisify(tx.objectStore(storeName).put(record));
  }

  /**
   * Delete a record
   * @param {string} storeName
   * @param {any} key
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    const tx = this.db.transaction(storeName, 'readwrite');
    return this.promisify(tx.objectStore(storeName).delete(key));
  }

  /**
   * Clear all records from a store
   * @param {string} storeName
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    const tx = this.db.transaction(storeName, 'readwrite');
    return this.promisify(tx.objectStore(storeName).clear());
  }

  /**
   * Clear multiple stores in a single transaction
   * @param {string[]} storeNames
   * @returns {Promise<void>}
   */
  async clearAll(storeNames) {
    const tx = this.db.transaction(storeNames, 'readwrite');
    const promises = storeNames.map((name) =>
      this.promisify(tx.objectStore(name).clear())
    );
    await Promise.all(promises);
  }
}

export default IndexedDBAdapter;
