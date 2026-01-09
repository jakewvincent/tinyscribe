# Live Transcription with Speaker Diarization

Browser-based speech recognition with speaker identification. All processing runs locally - no audio sent to servers.

## Quick Start

```bash
npm install
npm run dev
```

Requires COOP/COEP headers (configured in `vite.config.js`) for SharedArrayBuffer support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   index.html │───▶│   Alpine.js  │    │  Worker.js   │  │
│  │   styles.css │    │  (UI state)  │    │              │  │
│  └──────────────┘    └──────┬───────┘    │ - Whisper    │  │
│                             │            │ - WavLM      │  │
│                      ┌──────▼───────┐    │ - Phrases    │  │
│                      │    App.js    │───▶└──────────────┘  │
│                      │ - Audio cap  │           │          │
│                      │ - Enrollment │    ┌──────▼──────┐   │
│                      │ - Modal      │    │   Models    │   │
│                      └──────┬───────┘    │ (IndexedDB) │   │
│                             │            │  ~400MB     │   │
│                      ┌──────▼──────┐     └─────────────┘   │
│                      │ Transcript  │                       │
│                      │   Merger    │                       │
│                      │ + Clusterer │                       │
│                      └─────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

Alpine.js handles declarative UI state (panels, status bar, controls, enrollment sidebar).
App.js handles audio capture, modal dialogs, and worker communication.

## Models

| Model | Purpose | Size | Source |
|-------|---------|------|--------|
| Whisper Tiny | Speech-to-text (ASR) | ~39MB | `Xenova/whisper-tiny.en` |
| WavLM Base Plus SV | Speaker verification embeddings | ~360MB (fp32) | `Xenova/wavlm-base-plus-sv` |

Models are cached in IndexedDB after first download.

## Key Files

```
src/
├── main.js                 # Entry point, instantiates App
├── app.js                  # Main controller (audio, modals, worker communication)
├── worker.js               # Web Worker (model loading, inference)
├── styles.css              # All styling
│
├── alpine/                 # Alpine.js UI components
│   └── components.js       # Reactive components (panels, status bar, controls, enrollment)
│
├── config/                 # Centralized configuration
│   └── defaults.js         # All configurable constants (thresholds, colors, passages)
│
├── core/                   # Pure logic modules (no browser dependencies, reusable)
│   ├── embedding/
│   │   ├── embeddingUtils.js   # L2 normalize, cosine similarity
│   │   ├── speakerClusterer.js # Embedding-based speaker identification
│   │   └── pcaProjector.js     # PCA for 2D embedding projection
│   ├── transcription/
│   │   ├── phraseDetector.js   # Detects phrase boundaries from word timestamps
│   │   ├── overlapMerger.js    # Text-based overlap deduplication between chunks
│   │   └── transcriptMerger.js # Processes phrases with speaker assignments
│   ├── sound/
│   │   └── soundClassifier.js  # Classifies bracketed markers (speech vs environmental)
│   └── validation/
│       └── audioValidator.js   # Audio quality checks for enrollment
│
├── audio/                  # Browser audio layer (reusable)
│   ├── audioCapture.js     # Microphone capture, resampling to 16kHz
│   └── vadProcessor.js     # VAD-triggered speech detection (Silero VAD)
│
├── worker/                 # Worker abstraction
│   └── workerClient.js     # Promise-based API for worker communication
│
├── ui/                     # UI components
│   └── components/
│       ├── speakerVisualizer.js # Canvas visualization of speaker embeddings
│       └── debugPanel.js        # Debug logging UI controls
│
└── utils/
    └── enrollmentManager.js # Multi-speaker enrollment with Rainbow Passage
```

### Module Reusability

The codebase is organized for easy extraction:

- **`core/`**: Pure algorithms with zero browser dependencies. Can be copied directly to other JS projects.
- **`audio/`**: Browser audio capture. Reusable for any web audio application.
- **`worker/`**: WorkerClient provides promise-based async API for ML inference.
- **`alpine/`**: Declarative UI components using Alpine.js CDN (no build step required).
- **`config/`**: All thresholds and constants in one place for easy tuning.

## How It Works

### Recording Flow

1. **VAD Detection**: Silero VAD (legacy model) detects speech boundaries in real-time
2. **Audio Chunking**: Speech segments emitted as chunks (1-15s) with 1.5s overlap prepended
3. **ASR**: Whisper produces text with word-level timestamps
4. **Overlap Merging**: Text comparison (Levenshtein similarity) deduplicates words in overlap region
5. **Phrase Detection**: Words grouped into phrases based on gaps > 300ms
6. **Per-Phrase Embeddings**: WavLM extracts embeddings, mean-pooled per phrase → 512-dim vectors
7. **Sound Classification**: Environmental sounds ([MUSIC], [APPLAUSE]) separated from speech; [BLANK_AUDIO] filtered out
8. **Clustering**: Cosine similarity matches phrase embeddings to known speakers (environmental sounds skip clustering)
9. **Display**: Transcript rendered with speaker labels (or gray box for environmental sounds)

### Speaker Enrollment (Optional)

Users can pre-enroll up to 6 speakers using the Rainbow Passage (6 phonetically balanced sentences per speaker):

1. Enter speaker name, record 2+ sentences
2. System extracts embeddings for each recording
3. Embeddings averaged into single centroid per speaker
4. Saved to localStorage as array, pre-seeds speaker clusterer
5. Each enrolled speaker gets custom name and unique color in transcript
6. Add/remove individual speakers, or clear all

### Speaker Identification

Without enrollment:
- Pure online clustering based on embedding similarity
- Speakers labeled "Speaker 1", "Speaker 2", etc.

With enrollment:
- All enrolled speakers matched first (indices 0, 1, 2...)
- Each shows their custom name and assigned color
- Enrolled centroids stay fixed (prevents voice contamination)
- Additional speakers discovered during recording clustered normally

### Non-Speech Sound Handling

Whisper may output bracketed markers for non-speech sounds:
- **Human voice sounds** ([LAUGHTER], [COUGH], [SIGH], etc.) → attributed to speaker via clustering
- **Environmental sounds** ([MUSIC], [APPLAUSE], [NOISE], etc.) → shown in gray box, no speaker
- **Silence** ([BLANK_AUDIO]) → filtered out entirely
- **Unknown markers** → default to environmental (safer)

### Speaker Visualization

2D scatter plot showing speaker embedding relationships:
- Uses PCA (power iteration) to project 512-dim embeddings to 2D
- Enrolled speakers shown as colored, labeled dots
- Discovered speakers shown as hollow gray dots
- Closer dots = more similar voice characteristics
- Updates after enrollment changes

## Technical Notes

- **Sample rate**: All audio resampled to 16kHz (model requirement)
- **VAD model**: Silero VAD legacy (v5 has issues with subsequent speech segments)
- **Chunk duration**: VAD-triggered, 1-15 seconds based on speech boundaries
- **Overlap duration**: 1.5 seconds prepended to each chunk for seamless merging
- **Overlap merging**: Text-based comparison using Levenshtein similarity (≥85% threshold)
- **Phrase gap threshold**: 300ms gap between words triggers phrase boundary
- **Min phrase duration**: 500ms minimum for reliable embedding extraction
- **Embedding dimensions**: 512 (WavLM SV model output)
- **Similarity threshold**: 0.7 cosine similarity for speaker matching
- **Confidence margin**: 0.10 minimum difference between best and second-best match
- **Enrolled centroids**: Fixed during recording (not updated with new embeddings)
- **WebGPU**: Used for Whisper if available, otherwise WASM fallback
- **WavLM**: Always uses WASM with fp32 for accurate frame features
- **Alpine.js**: CDN-loaded (v3 + persist plugin), no build step. Components communicate with app.js via CustomEvents. Panel states persisted to localStorage.

## Configuration

All configurable constants are centralized in `src/config/defaults.js`:

- **Clustering**: similarity threshold, confidence margin, max speakers
- **VAD**: min/max speech duration, overlap duration, thresholds
- **Phrases**: gap threshold, min duration
- **Enrollment**: min samples, outlier threshold, Rainbow Passage sentences
- **UI**: speaker colors

**Runtime options**:
- **Expected Speakers**: Dropdown to set max speaker count (1-6). Limits how many unique speakers the clusterer will create.
- **Enrollment**: Optional. Enroll up to 6 speakers for reliable identification across sessions. Stored in localStorage (`speaker-enrollments` key).

## Limitations

- English only (using `whisper-tiny.en`)
- Speaker IDs can drift without enrollment
- Short phrases (<0.5s) may not get reliable embeddings
- Phrase boundaries depend on Whisper word timing accuracy

## Development Guidelines

### Modularity Principles

The codebase is organized into layers with strict dependency rules. This enables easy extraction and reuse of components in other projects.

**Dependency hierarchy** (each layer may only import from layers to its right):
```
alpine/ → app.js → ui/ → audio/ → worker/ → core/ → config/
```

**Layer responsibilities:**

| Layer | Browser APIs? | Purpose | Examples |
|-------|---------------|---------|----------|
| `config/` | No | Constants, thresholds, defaults | Speaker colors, VAD thresholds |
| `core/` | No | Pure algorithms, business logic | Clustering, phrase detection, embedding math |
| `worker/` | No* | Worker communication abstraction | WorkerClient promise-based API |
| `audio/` | Yes | Audio capture, VAD processing | AudioCapture, VADProcessor |
| `ui/` | Yes | Reusable UI components | SpeakerVisualizer, DebugPanel |
| `app.js` | Yes | Application orchestration | Modal dialogs, worker setup, audio routing |
| `alpine/` | Yes | Declarative UI state | Panel collapse, status bar, controls |

*WorkerClient uses `Worker` API but is designed for extraction with the worker it communicates with.

### Where to Put New Code

**Decision tree for new features:**

1. **Is it pure logic with no browser dependencies?** → `core/`
   - Can you run it in Node.js without polyfills? If yes, it belongs in `core/`
   - Examples: similarity calculations, text processing, clustering algorithms

2. **Does it capture or process audio?** → `audio/`
   - Wraps Web Audio API, MediaRecorder, etc.
   - Should accept callbacks/options, not import app-specific code

3. **Is it a reusable UI component?** → `ui/components/`
   - Accepts a DOM element or canvas, doesn't query the DOM itself
   - Example: `SpeakerVisualizer` accepts a canvas element

4. **Is it reactive UI state?** → `alpine/components.js`
   - Panel expand/collapse, button enabled/disabled, status display
   - Communicates with app.js via CustomEvents, not direct imports

5. **Does it orchestrate multiple systems?** → `app.js`
   - Modal dialogs with complex audio/VAD integration
   - Coordinates between Alpine, workers, and audio capture

### Alpine.js vs app.js

**Use Alpine for:**
- UI state that maps directly to DOM (show/hide, enabled/disabled, text content)
- Reactive bindings (`x-show`, `x-model`, `:disabled`, `x-for`)
- State that benefits from persistence (`Alpine.$persist`)
- Components that communicate via events, not shared state

**Keep in app.js:**
- Audio capture and VAD processing
- Modal dialogs with focus traps and complex interactions
- Worker communication and result handling
- Anything requiring async/await flows or complex state machines

**Communication pattern:**
```javascript
// Alpine → app.js: dispatch event with detail
window.dispatchEvent(new CustomEvent('enrollment-start', { detail: { name } }));

// app.js → Alpine: dispatch event for state update
window.dispatchEvent(new CustomEvent('enrollments-updated', { detail: { enrollments } }));
```

### Code Style

- **Configuration injection**: Modules accept config objects, don't import globals
  ```javascript
  // Good: accepts config
  constructor(options = {}) {
    this.threshold = options.threshold ?? DEFAULTS.threshold;
  }

  // Avoid: hardcoded values scattered in code
  if (similarity > 0.7) { ... }
  ```

- **Dependency injection**: Accept collaborators, don't instantiate internally
  ```javascript
  // Good: accepts dependencies
  constructor({ clusterer, classifier } = {}) {
    this.clusterer = clusterer ?? new SpeakerClusterer();
  }
  ```

- **Barrel exports**: Each directory has an `index.js` for clean imports
  ```javascript
  // Good
  import { SpeakerClusterer, cosineSimilarity } from './core/embedding';

  // Avoid
  import { SpeakerClusterer } from './core/embedding/speakerClusterer.js';
  ```

### Commits

- Use conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`)
- Add detailed description in the commit body
- Do not include Co-Authored-By or similar AI attribution lines
