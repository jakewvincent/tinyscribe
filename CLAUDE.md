# TinyScribe

Browser-based speech recognition with speaker identification. All processing runs locally - no audio sent to servers.

## Project Purpose

This is an **experimental/educational project** for exploring ASR (Automatic Speech Recognition) and speaker diarization systems. The primary goals are:

- **Gaining insight** into how speech recognition and speaker identification architectures work
- **Experimenting** with different approaches to clustering, hypothesis-building, and speaker attribution
- **Surfacing internals** that production systems typically hide - similarity scores, confidence margins, decision reasons, boosted vs unboosted attributions, etc.

The UI is designed for **nerdy exploration**, not polished end-user experience. When adding features, consider: "Does this help the user understand what the system is doing and why?" Data that reveals the decision-making process is inherently interesting and valuable here.

This means:
- Verbose debug information is welcome, not clutter
- Showing alternative hypotheses, runner-up candidates, and confidence metrics adds value
- Visualizations of embeddings, similarity distributions, and clustering behavior are encouraged
- "Why did it decide X?" should be answerable from the UI

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

### Swappable Models

To support the experimental nature of this project, model choices are **configurable and swappable** at runtime. This allows A/B testing different models and observing their behavior differences - perfect for gaining insight into how different architectures perform.

#### Current Implementation Status

1. **Speaker Segmentation Models** ✅ Implemented
   - Swappable via UI dropdown in the Segmentation Tuning panel
   - Available backends: Phrase-gap heuristic (text-based) and Pyannote 3.0 (acoustic)
   - Each backend exposes tunable parameters in the UI

2. **Speaker Embedding Models** 🔧 Infrastructure exists
   - Backend abstraction layer in `worker/backends/`
   - Multiple backends: Transformers.js WavLM, Sherpa-ONNX 3D-Speaker, direct ONNX
   - Not yet exposed in UI for runtime switching

3. **ASR Models** (lower priority)
   - Speech-to-text; currently Whisper Tiny
   - No swapping infrastructure yet

#### Suggested Model Combinations for Experimentation

**Lightweight + Better Diarization (Recommended to try):**

| Component | Model | Size | Embedding Dim | Notes |
|-----------|-------|------|---------------|-------|
| Segmentation | [pyannote-segmentation-3.0](https://huggingface.co/onnx-community/pyannote-segmentation-3.0) | ~6MB | N/A | Frame-level speaker classification |
| Embedding | [3D-Speaker ERes2Net](https://github.com/modelscope/3D-Speaker) | ~26.5MB | 192 | VoxCeleb-trained, good English performance |

**Alternative Embedding Models to Compare:**

| Model | Size | Embedding Dim | Source | Notes |
|-------|------|---------------|--------|-------|
| WavLM Base+ SV (current) | ~360MB | 512 | `Xenova/wavlm-base-plus-sv` | Large but high quality |
| 3D-Speaker ERes2Net | ~26.5MB | 192 | sherpa-onnx releases | 13x smaller than WavLM |
| 3D-Speaker ERes2NetV2 | ~71MB | 192 | sherpa-onnx releases | Better on short utterances |
| NeMo TitaNet-S | ~24MB | 192 | NVIDIA NeMo | 6M params, near SOTA |
| WeSpeaker ResNet34-LM | ~100MB | 256 | pyannote default | Good balance |
| WeSpeaker ECAPA-TDNN512 | ~80MB | 512 | WeSpeaker | Efficient architecture |

**Segmentation Model Options:**

| Model | Size | Status | Notes |
|-------|------|--------|-------|
| Phrase-gap heuristic | 0MB | ✅ Implemented | Text-based, uses Whisper word timing |
| pyannote-segmentation-3.0 | ~6MB | ✅ Implemented | Acoustic, handles overlapping speech |
| sherpa-onnx-reverb-diarization-v1 | TBD | Not implemented | Alternative acoustic segmentation |

#### Backend Architecture

The backend abstraction layer enables swappable models:

```
┌─────────────────────────────────────────────────────────────┐
│                   worker/backends/                          │
│  ┌─────────────────┐  ┌─────────────────────┐              │
│  │ Embedding       │  │ Segmentation        │              │
│  │ Backends        │  │ Backends            │              │
│  │ (3 options)     │  │ (2 implemented)     │              │
│  └────────┬────────┘  └────────┬────────────┘              │
│           │                    │                            │
│           ▼                    ▼                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Unified Interfaces                         ││
│  │  EmbeddingBackend { extractEmbedding(audio) }          ││
│  │  SegmentationBackend { segment(audio, words) }         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

Key resources:
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - WebAssembly-ready speech toolkit with speaker diarization
- [sherpa-onnx WASM demo](https://huggingface.co/spaces/k2-fsa/web-assembly-speaker-diarization-sherpa-onnx)
- [pyannote-segmentation-3.0 ONNX](https://huggingface.co/onnx-community/pyannote-segmentation-3.0) - Works with Transformers.js

## Key Files

```
src/
├── main.js                 # Entry point, instantiates App
├── app.js                  # Main controller (audio, modals, worker communication, recordings)
├── worker.js               # Web Worker (model loading, inference)
├── styles.css              # All styling
│
├── alpine/                 # Alpine.js UI components
│   └── components.js       # Reactive components (panels, status bar, controls, recordings)
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
│   ├── inference/
│   │   └── conversationInference.js # Hypothesis-based speaker boosting and stats
│   ├── recording/
│   │   ├── recordingSerializer.js   # Float32Array serialization for IndexedDB
│   │   └── wavEncoder.js            # WAV encoding and audio download
│   ├── sound/
│   │   └── soundClassifier.js  # Classifies bracketed markers (speech vs environmental)
│   └── validation/
│       └── audioValidator.js   # Audio quality checks for enrollment
│
├── audio/                  # Browser audio layer (reusable)
│   ├── audioCapture.js     # Microphone capture, resampling to 16kHz
│   ├── vadProcessor.js     # VAD-triggered speech detection (Silero VAD)
│   └── audioPlayback.js    # Web Audio API playback for saved recordings
│
├── storage/                # Persistence layer
│   ├── keys.js             # All storage keys (localStorage + IndexedDB)
│   ├── localStorage/       # Preferences, enrollments, debug settings
│   └── indexedDB/
│       └── stores/
│           ├── debugLogStore.js    # Debug session logs
│           └── recordingStore.js   # Saved recordings with audio chunks
│
├── worker/                 # Worker abstraction
│   ├── workerClient.js     # Promise-based API for worker communication
│   └── backends/           # Swappable model backends
│       ├── embeddingBackend.js      # Base embedding interface
│       ├── transformersBackend.js   # Transformers.js WavLM backend
│       ├── sherpaBackend.js         # Sherpa-ONNX 3D-Speaker backend
│       ├── onnxBackend.js           # Direct ONNX runtime backend
│       └── segmentation/
│           ├── segmentationBackend.js   # Base segmentation interface
│           ├── phraseGapBackend.js      # Text-based phrase gap heuristic
│           └── pyannoteSegBackend.js    # Pyannote acoustic segmentation
│
├── ui/                     # UI components
│   └── components/
│       ├── speakerVisualizer.js # Canvas visualization of speaker embeddings
│       ├── participantsPanel.js # Active speakers with stats and trends
│       └── debugPanel.js        # Debug logging UI controls
│
└── utils/
    └── enrollmentManager.js # Multi-speaker enrollment with Rainbow Passage
```

### Module Reusability

The codebase is organized for easy extraction:

- **`core/`**: Pure algorithms with zero browser dependencies. Can be copied directly to other JS projects.
- **`audio/`**: Browser audio capture and playback. Reusable for any web audio application.
- **`storage/`**: IndexedDB and localStorage wrappers. Pattern: stores follow DebugLogStore as template.
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

### Recording Management

Sessions are automatically saved when recording stops:
- **Storage**: IndexedDB with two-store pattern (metadata separate from audio chunks for performance)
- **Audio**: Float32Array chunks serialized to regular arrays for storage (~5-10MB per 10-min recording)
- **Replay**: Saved recordings can be loaded and played back via Web Audio API
- **Enrollments**: Each recording snapshots the active enrollments; when viewing, can toggle between snapshot and current enrollments to re-cluster with different speaker identities
- **Max recordings**: Oldest auto-deleted when exceeding limit (configurable, default 20)

Export options:
- **Download audio**: Export recording as WAV file (16-bit PCM, 16kHz)
- **Export transcript**: Download processed transcript as JSON (includes segments, speaker info, similarity scores)
- **Export raw chunks**: Download raw Whisper output per chunk as JSON

Management:
- **Rename**: Click recording name to edit
- **Delete**: Remove individual recordings from storage

### Hypothesis-Based Speaker Boosting

The ConversationInference module tracks conversational patterns to improve attribution:
- Builds hypotheses about who is speaking based on turn-taking patterns
- When two speakers alternate, subsequent ambiguous segments get a "boost" toward the expected speaker
- Tracks statistics: how often boosting changed the result, confirmation rate
- Debug UI shows whether each segment was boosted and by how much

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
- **IndexedDB**: Used for ML model cache (~400MB) and saved recordings. Two-store pattern for recordings separates metadata from audio chunks.
- **Audio cloning**: In `handleAudioChunk()`, audio is cloned before queuing since pipeline never mutates Float32Arrays. This captures audio for recording without interference.
- **WAV export**: Recordings downloadable as 16-bit PCM WAV at 16kHz sample rate.

## Configuration

All configurable constants are centralized in `src/config/defaults.js`:

- **Clustering**: similarity threshold, confidence margin, max speakers
- **VAD**: min/max speech duration, overlap duration, thresholds
- **Phrases**: gap threshold, min duration
- **Enrollment**: min samples, outlier threshold, Rainbow Passage sentences
- **Recordings**: max recordings, default name format, auto-save behavior
- **UI**: speaker colors

**Runtime options**:
- **Expected Speakers**: Dropdown to set max speaker count (1-6). Limits how many unique speakers the clusterer will create.
- **Enrollment**: Optional. Enroll up to 6 speakers for reliable identification across sessions. Stored in localStorage (`speaker-enrollments` key).

## Limitations

- English only (using `whisper-tiny.en`)
- Speaker IDs can drift without enrollment
- Short phrases (<0.5s) may not get reliable embeddings
- Phrase boundaries depend on Whisper word timing accuracy

## Testing

Tests use [Vitest](https://vitest.dev/) for fast, Vite-native testing.

```bash
npm test              # Watch mode (re-runs on file changes)
npm run test:run      # Single run (CI-friendly)
npm run test:coverage # With coverage report
```

### Test Structure

```
tests/
├── unit/                    # Unit tests for pure modules
│   ├── core/
│   │   ├── embedding/
│   │   │   ├── speakerClusterer.test.js
│   │   │   └── embeddingUtils.test.js
│   │   └── transcription/
│   │       ├── overlapMerger.test.js
│   │       └── phraseDetector.test.js
│   └── storage/
│       └── localStorageAdapter.test.js
└── integration/             # Integration tests for critical flows
    └── enrollmentFlow.test.js
```

### What's Tested

- **SpeakerClusterer**: Speaker assignment, enrollment import/export, reset behavior, label generation
- **embeddingUtils**: L2 normalization, cosine similarity edge cases
- **OverlapMerger**: Text-based overlap merging, Levenshtein distance, fuzzy matching
- **PhraseDetector**: Phrase boundary detection, embedding extraction from frame features
- **LocalStorageAdapter**: String/JSON/boolean storage, error handling (uses vitest mocks)
- **Enrollment Flow**: Verifies enrolled speakers propagate to channel mergers (caught regression in dual-input support)

### CI

Tests run automatically on push and PR via GitHub Actions (`.github/workflows/test.yml`). The workflow tests against Node.js 20 and 22.

### Testing Philosophy

Focus tests on `core/` modules since they're pure functions without browser dependencies. Integration tests target critical flows where regressions have occurred or would be costly (e.g., enrollment propagation bug).

When adding tests:
1. Unit tests for `core/` modules are straightforward—no mocking needed
2. Integration tests can compose multiple `core/` classes to test data flow
3. Browser-dependent code (`audio/`, `storage/`, `ui/`) would require mocked APIs

## Development Guidelines

### Modularity Principles

The codebase is organized into layers with strict dependency rules. This enables easy extraction and reuse of components in other projects.

**Dependency hierarchy** (each layer may only import from layers to its right):
```
alpine/ → app.js → ui/ → audio/ → storage/ → worker/ → core/ → config/
```

**Layer responsibilities:**

| Layer | Browser APIs? | Purpose | Examples |
|-------|---------------|---------|----------|
| `config/` | No | Constants, thresholds, defaults | Speaker colors, VAD thresholds |
| `core/` | No | Pure algorithms, business logic | Clustering, phrase detection, embedding math |
| `storage/` | Yes | Persistence (localStorage, IndexedDB) | RecordingStore, DebugLogStore |
| `worker/` | No* | Worker communication abstraction | WorkerClient promise-based API |
| `audio/` | Yes | Audio capture, VAD, playback | AudioCapture, VADProcessor, AudioPlayback |
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

3. **Does it persist data?** → `storage/`
   - IndexedDB stores go in `storage/indexedDB/stores/`, follow DebugLogStore pattern
   - Add keys to `storage/keys.js` for all storage identifiers

4. **Is it a reusable UI component?** → `ui/components/`
   - Accepts a DOM element or canvas, doesn't query the DOM itself
   - Example: `SpeakerVisualizer` accepts a canvas element

5. **Is it reactive UI state?** → `alpine/components.js`
   - Panel expand/collapse, button enabled/disabled, status display
   - Communicates with app.js via CustomEvents, not direct imports

6. **Does it orchestrate multiple systems?** → `app.js`
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

### Styling

All styling is in `src/styles.css` using CSS custom properties (design tokens) for consistency.

**Always use design tokens** instead of hardcoded values:
```css
/* Good: uses design tokens */
border-radius: var(--radius-md);
box-shadow: var(--shadow-sm);
padding: var(--space-sm);

/* Avoid: magic numbers */
border-radius: 6px;
box-shadow: 0 1px 2px rgba(0,0,0,0.05);
padding: 0.5rem;
```

**IMPORTANT - Check existing patterns before proposing new solutions:**

When styling components, especially for theme support (e.g., glassmorphism), **always check if semantic design tokens already handle the use case** before proposing theme-specific overrides like `[data-theme="glassmorphism"] .my-component { ... }`.

The design token system uses semantic tokens (e.g., `--panel-bg`, `--panel-shadow`, `--panel-radius`) that are remapped per theme. If you use these tokens in base styles, theme support comes automatically:

```css
/* Good: uses semantic tokens that themes remap automatically */
.my-component {
  background: var(--panel-bg);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow), var(--panel-inset-shadow);
}

/* Avoid: theme-specific override when semantic tokens would suffice */
[data-theme="glassmorphism"] .my-component {
  background: var(--glass-faint);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), var(--glass-inset);
}
```

Before writing any theme-specific CSS, ask: "Do semantic tokens already exist that get remapped by themes?" Check `:root` and `[data-theme="glassmorphism"]` in styles.css to see which tokens have theme-specific values.

See `STYLING.md` for the complete design token reference and usage guidelines.

### Commits

- Use conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`)
- Add detailed description in the commit body
- Do not include Co-Authored-By or similar AI attribution lines
