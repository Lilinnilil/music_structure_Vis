# Music Structure Visualizer

An interactive browser-based visualizer for MIDI-derived music data with synchronized audio playback.

The app has a single main view. It supports Piano Roll, Rhythmic Framework, Monophonic Melody, Expanded Melody, and Rhythmic Melody modes.

## Features

- Load available pieces from `data/manifest.json`
- Play synchronized audio from `public/mp3`
- Explore pitch, timing, velocity, instrument color, rhythm, and melodic motion
- Toggle percussion visibility
- Scrub through time with the horizontal timeline control
- Extend the dataset by adding new MIDI files and processing them with the included script

## Project Structure

```text
.
|-- index.html                    # Main application page
|-- src/
|   |-- app.js                    # Dataset loading and audio playback wrapper
|   |-- visualizer.js             # Core visualization logic
|   |-- config.js                 # Shared constants and helper functions
|   `-- archive/                  # Legacy/reference files not used by the app
|-- data/
|   |-- manifest.json             # Track list used by the dropdown
|   |-- midi/                     # Put new MIDI files here
|   `-- processed/                # Generated CSV/JSON files
|-- public/
|   `-- mp3/                      # Audio files used for playback
`-- scripts/
    `-- midi_to_csv_clean.py      # MIDI processing pipeline
```

## Running the App

Serve the repository root with a local HTTP server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

The app uses D3.js and Tone.js from CDNs, so an internet connection is required unless those dependencies are vendored locally.

## Adding New MIDI Files

The project is designed to be extensible. To add a new piece:

1. Put the MIDI file in:

```text
data/midi/
```

2. Run the processing script from the `scripts` directory:

```bash
cd scripts
python midi_to_csv_clean.py
```

3. Choose mode `2s` when prompted.

This batch-processes MIDI files in `data/midi/`, writes the generated data into `data/processed/`, and appends the processed track names to `data/manifest.json`.

4. If you have a matching audio file, place it in:

```text
public/mp3/
```

Use the same base filename as the MIDI file, with `.mp3` as the extension.

Example:

```text
data/midi/My Piece.mid
public/mp3/My Piece.mp3
data/processed/My Piece_notes_clean.csv
data/processed/My Piece_info.json
```

5. Refresh the browser. The new piece should appear in the dropdown list.

## Generated Data

For each processed MIDI file, the app expects:

- `data/processed/<name>_notes_clean.csv`
- `data/processed/<name>_info.json`
- an entry for `<name>` in `data/manifest.json`

For synchronized playback, add:

- `public/mp3/<name>.mp3`

The notes CSV should include:

- `time_start_sec`
- `duration_sec`
- `pitch`
- `velocity`
- `track_new`

## Notes

- The visualizer reads `data/manifest.json` at startup.
- File base names must match across MIDI-derived data and MP3 audio.
- If no MP3 is available, the visualization data can still load, but audio playback will not be synchronized.
