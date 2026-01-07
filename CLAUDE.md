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
│                      │ - Audio cap  │    │ - Pyannote   │  │
│                      │ - Enrollment │    │ - WavLM      │  │
│                      └──────────────┘    └──────────────┘  │
│                             │                   │          │
│                      ┌──────▼──────┐    ┌──────▼──────┐   │
│                      │ Transcript  │    │   Models    │   │
│                      │   Merger    │    │ (IndexedDB) │   │
│                      │ + Clusterer │    │  ~150MB     │   │
│                      └─────────────┘    └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Models

| Model | Purpose | Size | Source |
|-------|---------|------|--------|
| Whisper Tiny | Speech-to-text (ASR) | ~39MB | `Xenova/whisper-tiny.en` |
| Pyannote Segmentation | Speaker change detection | ~6MB | `onnx-community/pyannote-segmentation-3.0` |
| WavLM | Speaker embeddings | ~102MB (q8) | `Xenova/wavlm-base-plus-sv` |

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
    ├── transcriptMerger.js # Aligns ASR words with speaker segments
    ├── speakerClusterer.js # Embedding-based speaker identification
    ├── enrollmentManager.js # Multi-speaker enrollment with Rainbow Passage
    ├── pcaProjector.js     # PCA for 2D embedding projection
    └── speakerVisualizer.js # Canvas visualization of speaker embeddings
```

## How It Works

### Recording Flow

1. **Audio Capture**: Microphone → 5-second chunks (0.5s overlap) → 16kHz mono Float32Array
2. **Worker Processing** (parallel):
   - Whisper: audio → text with word timestamps
   - Pyannote: audio → speaker change segments
3. **Embedding Extraction**: WavLM extracts 512-dim vector per segment
4. **Clustering**: Cosine similarity matches segments to known speakers
5. **Merging**: Words aligned to clustered speaker segments
6. **Display**: Transcript rendered with speaker labels and timestamps

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
- Additional speakers discovered during recording clustered normally

### Speaker Visualization

2D scatter plot showing speaker embedding relationships:
- Uses PCA (power iteration) to project 512-dim embeddings to 2D
- Enrolled speakers shown as colored, labeled dots
- Discovered speakers shown as hollow gray dots
- Closer dots = more similar voice characteristics
- Updates after enrollment changes

## Technical Notes

- **Sample rate**: All audio resampled to 16kHz (model requirement)
- **Chunk duration**: 5 seconds with 0.5s overlap for continuity
- **Embedding dimensions**: 512 (WavLM output)
- **Similarity threshold**: 0.7 cosine similarity for speaker matching
- **Quantization**: WavLM uses q8 (8-bit) for smaller size
- **WebGPU**: Used for Whisper if available, otherwise WASM fallback
- **WASM only**: Pyannote and WavLM always use WASM

## Configuration

**Expected Speakers**: Dropdown to set max speaker count (1-6). Limits how many unique speakers the clusterer will create.

**Enrollment**: Optional. Enroll up to 6 speakers for reliable identification across sessions. Stored in localStorage (`speaker-enrollments` key).

## Limitations

- English only (using `whisper-tiny.en`)
- Pyannote segmentation is frame-level, not true diarization
- Speaker IDs can drift without enrollment
- Short utterances (<0.5s) may not get reliable embeddings
