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
│  │   index.html │───▶│    App.js    │───▶│  Worker.js   │  │
│  │   styles.css │    │              │    │              │  │
│  └──────────────┘    │ - UI control │    │ - Whisper    │  │
│                      │ - Audio cap  │    │ - WavLM      │  │
│                      │ - Enrollment │    │ - Phrases    │  │
│                      └──────────────┘    └──────────────┘  │
│                             │                   │          │
│                      ┌──────▼──────┐    ┌──────▼──────┐   │
│                      │ Transcript  │    │   Models    │   │
│                      │   Merger    │    │ (IndexedDB) │   │
│                      │ + Clusterer │    │  ~400MB     │   │
│                      └─────────────┘    └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

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
├── app.js                  # Main controller (UI, recording, enrollment)
├── worker.js               # Web Worker (model loading, inference)
├── styles.css              # All styling
└── utils/
    ├── audioCapture.js     # Microphone capture, resampling to 16kHz
    ├── phraseDetector.js   # Detects phrase boundaries from word timestamps
    ├── transcriptMerger.js # Processes phrases with speaker assignments
    ├── speakerClusterer.js # Embedding-based speaker identification
    ├── enrollmentManager.js # Multi-speaker enrollment with Rainbow Passage
    ├── pcaProjector.js     # PCA for 2D embedding projection
    └── speakerVisualizer.js # Canvas visualization of speaker embeddings
```

## How It Works

### Recording Flow

1. **Audio Capture**: Microphone → 5-second chunks → 16kHz mono Float32Array
2. **ASR**: Whisper produces text with word-level timestamps
3. **Carryover**: Last word discarded, audio from that point carried to next chunk for re-transcription (ensures words aren't cut off at chunk boundaries)
4. **Phrase Detection**: Words grouped into phrases based on gaps > 300ms
5. **Frame Features**: Single WavLM call extracts frame-level features for entire chunk
6. **Per-Phrase Embeddings**: Frame features sliced and mean-pooled per phrase → 768-dim vectors
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
- Uses PCA (power iteration) to project 768-dim embeddings to 2D
- Enrolled speakers shown as colored, labeled dots
- Discovered speakers shown as hollow gray dots
- Closer dots = more similar voice characteristics
- Updates after enrollment changes

## Technical Notes

- **Sample rate**: All audio resampled to 16kHz (model requirement)
- **Chunk duration**: 5 seconds with carryover-based continuity (last word re-transcribed in next chunk)
- **Phrase gap threshold**: 300ms gap between words triggers phrase boundary
- **Min phrase duration**: 500ms minimum for reliable embedding extraction
- **Embedding dimensions**: 512 (WavLM SV model output)
- **Similarity threshold**: 0.7 cosine similarity for speaker matching
- **Confidence margin**: 0.10 minimum difference between best and second-best match
- **Enrolled centroids**: Fixed during recording (not updated with new embeddings)
- **WebGPU**: Used for Whisper if available, otherwise WASM fallback
- **WavLM**: Always uses WASM with fp32 for accurate frame features

## Configuration

**Expected Speakers**: Dropdown to set max speaker count (1-6). Limits how many unique speakers the clusterer will create.

**Enrollment**: Optional. Enroll up to 6 speakers for reliable identification across sessions. Stored in localStorage (`speaker-enrollments` key).

## Limitations

- English only (using `whisper-tiny.en`)
- Speaker IDs can drift without enrollment
- Short phrases (<0.5s) may not get reliable embeddings
- Phrase boundaries depend on Whisper word timing accuracy

## Development Preferences

- **Commits**: Do not include Co-Authored-By or similar AI attribution lines in commit messages
