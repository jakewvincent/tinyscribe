/**
 * Overlap Merger
 * Compares transcriptions from overlapping audio regions to find consensus merge points
 */

export class OverlapMerger {
  constructor(options = {}) {
    // Similarity threshold for text matching
    this.similarityThreshold = options.similarityThreshold || 0.8;

    // Minimum words to consider a valid match
    this.minMatchLength = options.minMatchLength || 2;
  }

  /**
   * Find the best merge point between two overlapping transcriptions
   * @param {Array} prevWords - Words from previous chunk [{text, timestamp: [start, end]}]
   * @param {Array} currWords - Words from current chunk
   * @param {number} overlapDuration - Duration of overlap region in seconds
   * @returns {Object} { mergeIndex, confidence, method, matchedWords }
   */
  findMergePoint(prevWords, currWords, overlapDuration) {
    if (!prevWords || prevWords.length === 0 || !currWords || currWords.length === 0) {
      return {
        mergeIndex: 0,
        confidence: 1.0,
        method: 'no_overlap',
        matchedWords: [],
      };
    }

    if (overlapDuration <= 0) {
      return {
        mergeIndex: 0,
        confidence: 1.0,
        method: 'no_overlap',
        matchedWords: [],
      };
    }

    // Extract words from overlap regions
    // Previous chunk: words near the end (within overlap duration of the end)
    // Current chunk: words near the start (within overlap duration)
    const prevOverlapWords = this.getOverlapWordsFromEnd(prevWords, overlapDuration);
    const currOverlapWords = this.getOverlapWordsFromStart(currWords, overlapDuration);

    if (prevOverlapWords.length === 0 || currOverlapWords.length === 0) {
      // No words in overlap region - use timestamp-based fallback
      return this.timestampFallback(currWords, overlapDuration);
    }

    // Try text-based alignment
    const textMatch = this.findTextAlignment(prevOverlapWords, currOverlapWords, currWords);

    if (textMatch.confidence >= this.similarityThreshold) {
      return textMatch;
    }

    // Fall back to timestamp-based merge
    return this.timestampFallback(currWords, overlapDuration);
  }

  /**
   * Get words from the end of a chunk that fall within the overlap duration
   */
  getOverlapWordsFromEnd(words, overlapDuration) {
    if (words.length === 0) return [];

    // Find the end time of the last word
    const lastWord = words[words.length - 1];
    const chunkEndTime = lastWord.timestamp?.[1] || 0;
    const overlapStartTime = chunkEndTime - overlapDuration;

    return words.filter((w) => {
      const wordStart = w.timestamp?.[0] || 0;
      return wordStart >= overlapStartTime;
    });
  }

  /**
   * Get words from the start of a chunk that fall within the overlap duration
   * Uses wordStart (not wordEnd) to match logic in getOverlapWordsFromEnd.
   * A word that starts within overlap should be included even if it extends past.
   */
  getOverlapWordsFromStart(words, overlapDuration) {
    return words.filter((w) => {
      const wordStart = w.timestamp?.[0] || 0;
      return wordStart < overlapDuration;
    });
  }

  /**
   * Find best text alignment between overlap regions
   */
  findTextAlignment(prevOverlapWords, currOverlapWords, allCurrWords) {
    const prevTexts = prevOverlapWords.map((w) => this.normalizeWord(w.text));
    const currTexts = currOverlapWords.map((w) => this.normalizeWord(w.text));

    let bestMatch = {
      mergeIndex: 0,
      confidence: 0,
      method: 'text_match',
      matchedWords: [],
    };

    // Try different window sizes (prefer longer matches)
    for (
      let windowSize = Math.min(prevTexts.length, currTexts.length);
      windowSize >= this.minMatchLength;
      windowSize--
    ) {
      // Slide window through previous chunk's overlap
      for (let prevStart = 0; prevStart <= prevTexts.length - windowSize; prevStart++) {
        const prevWindow = prevTexts.slice(prevStart, prevStart + windowSize);

        // Slide window through current chunk's overlap
        for (let currStart = 0; currStart <= currTexts.length - windowSize; currStart++) {
          const currWindow = currTexts.slice(currStart, currStart + windowSize);

          const similarity = this.calculateSequenceSimilarity(prevWindow, currWindow);

          if (similarity > bestMatch.confidence) {
            // Find the index in allCurrWords where unique content begins
            // It's after the matched window in currOverlapWords
            const matchEndInOverlap = currStart + windowSize;
            const matchedWord = currOverlapWords[matchEndInOverlap - 1];

            // Find this word's index in the full current words array
            let mergeIndex = 0;
            for (let i = 0; i < allCurrWords.length; i++) {
              if (
                allCurrWords[i].text === matchedWord?.text &&
                Math.abs((allCurrWords[i].timestamp?.[0] || 0) - (matchedWord?.timestamp?.[0] || 0)) <
                  0.1
              ) {
                mergeIndex = i + 1; // Start after this word
                break;
              }
            }

            bestMatch = {
              mergeIndex,
              confidence: similarity,
              method: 'text_match',
              matchedWords: currWindow,
              timestamp: matchedWord?.timestamp?.[1] || overlapDuration,
            };
          }
        }
      }

      // If we found a good match at this window size, stop
      if (bestMatch.confidence >= this.similarityThreshold) {
        break;
      }
    }

    return bestMatch;
  }

  /**
   * Fall back when text matching fails - keep all words since we have no
   * evidence of actual duplication. Previously this removed words based on
   * timestamps alone, which caused data loss when chunks had unrelated content.
   */
  timestampFallback(currWords, overlapDuration) {
    // Without text match evidence, we can't be confident any words are duplicates.
    // The safe default is to keep all words (mergeIndex = 0) to avoid data loss.
    return {
      mergeIndex: 0,
      confidence: 0,
      method: 'no_text_match',
      matchedWords: [],
      timestamp: overlapDuration,
    };
  }

  /**
   * Normalize a word for comparison
   */
  normalizeWord(word) {
    if (!word) return '';
    return word
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .trim();
  }

  /**
   * Calculate similarity between two word sequences
   * Uses word-level comparison with exact matching
   */
  calculateSequenceSimilarity(seq1, seq2) {
    if (seq1.length !== seq2.length) return 0;
    if (seq1.length === 0) return 0;

    let matches = 0;
    for (let i = 0; i < seq1.length; i++) {
      if (seq1[i] === seq2[i]) {
        matches++;
      } else if (this.fuzzyMatch(seq1[i], seq2[i])) {
        matches += 0.8; // Partial credit for fuzzy matches
      }
    }

    return matches / seq1.length;
  }

  /**
   * Fuzzy match for similar words (handles minor transcription differences)
   */
  fuzzyMatch(word1, word2) {
    if (!word1 || !word2) return false;

    // Exact match
    if (word1 === word2) return true;

    // One is substring of other (e.g., "going" vs "goin")
    if (word1.includes(word2) || word2.includes(word1)) return true;

    // Levenshtein distance for similar words
    const distance = this.levenshteinDistance(word1, word2);
    const maxLen = Math.max(word1.length, word2.length);
    const similarity = 1 - distance / maxLen;

    return similarity >= 0.75;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;

    // Create distance matrix
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill in the rest
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Adjust word timestamps after merge (subtract overlap duration)
   */
  adjustTimestamps(words, overlapDuration) {
    return words.map((word) => ({
      ...word,
      timestamp: word.timestamp
        ? [
            Math.max(0, word.timestamp[0] - overlapDuration),
            Math.max(0, word.timestamp[1] - overlapDuration),
          ]
        : word.timestamp,
    }));
  }
}
