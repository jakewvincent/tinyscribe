# TinyScribe

Browser-based speech transcription with real-time speaker diarization. All processing runs locally using tiny ML models—no audio is sent to any server.

## Features

- **Real-time transcription** via Whisper (tiny.en model, ~39MB)
- **Speaker identification** using voice embeddings (WavLM, ~360MB)
- **Speaker enrollment** for persistent identification across sessions
- **Multiple segmentation backends**: text-based phrase detection or acoustic segmentation (Pyannote 3.0)
- **Debug views** exposing similarity scores, clustering decisions, and hypothesis tracking
- **Recording management** with playback, export (WAV/JSON), and re-processing

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge, or Firefox (Safari has known compatibility issues).

## How It Works

1. **VAD Detection**: Silero VAD detects speech boundaries in real-time
2. **Chunking**: Speech segments are captured as overlapping chunks (1-15s)
3. **Transcription**: Whisper produces text with word-level timestamps
4. **Phrase Detection**: Words grouped into phrases based on timing gaps
5. **Speaker Embedding**: WavLM extracts voice embeddings for each phrase
6. **Clustering**: Cosine similarity matches embeddings to known/discovered speakers
7. **Display**: Transcript rendered with speaker labels and colors

## Models

| Model | Purpose | Size |
|-------|---------|------|
| [Whisper Tiny](https://huggingface.co/Xenova/whisper-tiny.en) | Speech-to-text | ~39MB |
| [WavLM Base+ SV](https://huggingface.co/Xenova/wavlm-base-plus-sv) | Speaker embeddings | ~360MB |
| [Pyannote Seg 3.0](https://huggingface.co/onnx-community/pyannote-segmentation-3.0) | Acoustic segmentation | ~6MB |

Models are downloaded on first use and cached in IndexedDB.

## Browser Requirements

- Chrome, Edge, or Firefox (latest versions)
- SharedArrayBuffer support (requires COOP/COEP headers—handled by dev server)
- ~500MB storage for model cache

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Alpine.js  │    │    App.js    │    │  Web Worker  │  │
│  │   (UI state) │◄──►│  (orchestr.) │◄──►│  (ML models) │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                    │          │
│         ▼                   ▼                    ▼          │
│  ┌─────────────┐    ┌─────────────┐      ┌───────────┐     │
│  │   index.html│    │ Audio/VAD   │      │  Whisper  │     │
│  │   styles.css│    │ Processing  │      │  WavLM    │     │
│  └─────────────┘    └─────────────┘      │  Pyannote │     │
│                                          └───────────┘     │
│                                                 │          │
│                                          ┌──────▼──────┐   │
│                                          │  IndexedDB  │   │
│                                          │  (models +  │   │
│                                          │  recordings)│   │
│                                          └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── main.js              # Entry point
├── app.js               # Main controller
├── worker.js            # Web Worker for ML inference
├── alpine/              # UI components (Alpine.js)
├── audio/               # Audio capture, VAD, playback
├── config/              # Model configs, defaults
├── core/                # Pure algorithms (clustering, merging, inference)
├── storage/             # IndexedDB + localStorage
├── worker/backends/     # Swappable model backends
└── ui/                  # Visualization components
```

## Tech Stack

- **UI**: Alpine.js (reactive state), vanilla CSS with design tokens
- **ML Runtime**: Transformers.js, ONNX Runtime Web
- **Audio**: Web Audio API, Silero VAD
- **Build**: Vite

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed architecture docs, module organization, and contribution guidelines.

## License

MIT
