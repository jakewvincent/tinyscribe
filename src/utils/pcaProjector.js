/**
 * PCA Projector
 * Projects high-dimensional speaker embeddings to 2D for visualization
 * Uses power iteration to find principal components (avoids full SVD)
 */

export class PCAProjector {
  constructor() {
    this.mean = null;
    this.components = null; // First 2 principal components
  }

  /**
   * Fit PCA on embeddings and project to 2D
   * @param {Array} embeddings - Array of {id, name, centroid, ...}
   * @returns {Array} - Array of {id, name, x, y, ...}
   */
  fitTransform(embeddings) {
    if (!embeddings || embeddings.length === 0) {
      return [];
    }

    if (embeddings.length === 1) {
      // Single point - center it
      return embeddings.map((e) => ({
        ...e,
        x: 0,
        y: 0,
      }));
    }

    const data = embeddings.map((e) => e.centroid);
    const n = data.length;
    const d = data[0].length;

    // 1. Compute mean
    this.mean = new Float32Array(d);
    for (const vec of data) {
      for (let i = 0; i < d; i++) {
        this.mean[i] += vec[i];
      }
    }
    for (let i = 0; i < d; i++) {
      this.mean[i] /= n;
    }

    // 2. Center data
    const centered = data.map((vec) => {
      const c = new Float32Array(d);
      for (let i = 0; i < d; i++) {
        c[i] = vec[i] - this.mean[i];
      }
      return c;
    });

    // 3. Find top 2 principal components using power iteration
    this.components = this.powerIteration(centered, 2);

    // 4. Project to 2D
    return embeddings.map((e, idx) => {
      const c = centered[idx];
      const x = this.dot(c, this.components[0]);
      const y = this.components.length > 1 ? this.dot(c, this.components[1]) : 0;
      return { ...e, x, y };
    });
  }

  /**
   * Dot product of two vectors
   */
  dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Power iteration to find top k eigenvectors of X^T X
   * @param {Array} centered - Centered data vectors
   * @param {number} k - Number of components to find
   * @returns {Array} Array of eigenvectors
   */
  powerIteration(centered, k) {
    const d = centered[0].length;
    const components = [];

    for (let comp = 0; comp < k; comp++) {
      // Random initial vector (use deterministic seed based on comp for reproducibility)
      let v = new Float32Array(d);
      for (let i = 0; i < d; i++) {
        // Simple deterministic initialization
        v[i] = Math.sin(i * (comp + 1) * 0.1) + Math.cos(i * 0.05);
      }

      // Normalize
      v = this.normalize(v);

      // Iterate until convergence
      for (let iter = 0; iter < 100; iter++) {
        // Multiply by X^T X (covariance approximation)
        const newV = new Float32Array(d);
        for (const x of centered) {
          const proj = this.dot(x, v);
          for (let i = 0; i < d; i++) {
            newV[i] += proj * x[i];
          }
        }

        // Remove previously found components (deflation)
        for (const prev of components) {
          const proj = this.dot(newV, prev);
          for (let i = 0; i < d; i++) {
            newV[i] -= proj * prev[i];
          }
        }

        v = this.normalize(newV);
      }

      components.push(v);
    }

    return components;
  }

  /**
   * Normalize a vector to unit length
   */
  normalize(v) {
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) return v;

    const result = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      result[i] = v[i] / norm;
    }
    return result;
  }
}
