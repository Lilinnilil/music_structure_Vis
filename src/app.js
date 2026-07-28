(function () {
    window.__VISUALIZER_APP__ = true;

    const selectEl = document.getElementById('track-select');
    let activePlaybackHandler = null;
    let activeAudioPlayer = null;
    let activeTrackName = null;
    let activeAudioUrl = null;
    let activeSelectionToken = 0;
    let playbackActive = false;
    let playbackOffset = 0;
    let playbackStartedAt = 0;
    let playbackAnimationFrameId = null;

    function setStatus(message) {
        if (message && message.includes('Failed')) console.warn(message);
    }

    function updatePlayButtonLabel(state) {
        const playButton = document.getElementById('playPauseBtn');
        if (!playButton) return;
        playButton.textContent = state === 'started' ? 'Pause' : 'Play';
    }

    function stopCurrentAudioPlayer() {
        if (activeAudioPlayer && typeof activeAudioPlayer.stop === 'function') {
            try {
                activeAudioPlayer.stop();
            } catch (error) {
                console.warn('Failed to stop current audio player', error);
            }
        }
    }

    function disposeCurrentAudioPlayer() {
        if (activeAudioPlayer && typeof activeAudioPlayer.dispose === 'function') {
            try {
                activeAudioPlayer.dispose();
            } catch (error) {
                console.warn('Failed to dispose previous audio player', error);
            }
        }
        activeAudioPlayer = null;
    }

    function stopPlaybackLoop() {
        if (playbackAnimationFrameId !== null) {
            cancelAnimationFrame(playbackAnimationFrameId);
            playbackAnimationFrameId = null;
        }
    }

    function startPlaybackLoop() {
        if (playbackAnimationFrameId !== null) {
            cancelAnimationFrame(playbackAnimationFrameId);
        }

        const tick = (timestamp) => {
            if (!playbackActive) return;
            const elapsed = (timestamp - playbackStartedAt) / 1000;
            Tone.Transport.seconds = playbackOffset + elapsed;
            if (typeof window.updateVisualizer === 'function') {
                window.updateVisualizer(false, false);
            }
            playbackAnimationFrameId = requestAnimationFrame(tick);
        };

        playbackStartedAt = performance.now();
        playbackAnimationFrameId = requestAnimationFrame(tick);
    }

    function bindTransportToAudio() {
        if (!window.Tone || !window.Tone.Transport) {
            return;
        }

        const transport = Tone.Transport;
        transport.off('start');
        transport.off('pause');
        transport.off('stop');

        transport.on('start', () => {
            updatePlayButtonLabel(transport.state);
        });

        transport.on('pause', () => {
            updatePlayButtonLabel(transport.state);
        });

        transport.on('stop', () => {
            updatePlayButtonLabel(transport.state);
        });
    }

    async function handlePlayback(audioPlayer = activeAudioPlayer) {
        if (!window.Tone || !window.Tone.Transport) {
            setStatus('Tone.js not available');
            return;
        }

        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        const transport = Tone.Transport;

        if (playbackActive) {
            playbackActive = false;
            window.__VISUALIZER_PLAYBACK_ACTIVE__ = false;
            playbackOffset = transport.seconds || playbackOffset;
            stopPlaybackLoop();
            stopCurrentAudioPlayer();
            transport.pause();
            updatePlayButtonLabel('paused');
            if (typeof window.updateVisualizer === 'function') {
                window.updateVisualizer(false, false);
            }
            return;
        }

        playbackActive = true;
        window.__VISUALIZER_PLAYBACK_ACTIVE__ = true;
        playbackOffset = Math.max(0, transport.seconds || 0);
        if (transport.state === 'stopped') {
            transport.seconds = playbackOffset;
        }
        if (transport.state !== 'started') {
            transport.start();
        }
        if (activeAudioPlayer && typeof activeAudioPlayer.start === 'function') {
            try {
                stopCurrentAudioPlayer();
                activeAudioPlayer.start(undefined, playbackOffset);
            } catch (error) {
                console.warn('Failed to sync audio start', error);
            }
        }
        updatePlayButtonLabel('started');
        startPlaybackLoop();
        if (typeof window.updateVisualizer === 'function') {
            window.updateVisualizer(false, false);
        }
    }

    function createToggleCallbacks() {
        return {
            togglePlayback: () => handlePlayback(activeAudioPlayer),
            setupAutoStop: () => {
                if (!window.Tone || !window.Tone.Transport) return;
                Tone.Transport.stop();
            }
        };
    }

    function bindPlayButton(handler) {
        const playButton = document.getElementById('playPauseBtn');
        if (playButton) {
            playButton.onclick = (event) => {
                event.preventDefault();
                handler();
            };
            playButton.textContent = 'Play';
        }
    }

    async function loadSelection(fileName) {
        const selectionToken = ++activeSelectionToken;
        const notesUrl = `./data/processed/${encodeURIComponent(fileName)}_notes_clean.csv`;
        const infoUrl = `./data/processed/${encodeURIComponent(fileName)}_info.json`;
        const audioUrl = `./public/mp3/${encodeURIComponent(fileName)}.mp3`;

        stopCurrentAudioPlayer();
        disposeCurrentAudioPlayer();
        playbackActive = false;
        window.__VISUALIZER_PLAYBACK_ACTIVE__ = false;
        stopPlaybackLoop();
        if (window.Tone && window.Tone.Transport) {
            Tone.Transport.stop();
            Tone.Transport.seconds = 0;
        }

        setStatus(`Loading ${fileName}…`);

        try {
            const [notes, info] = await Promise.all([
                d3.csv(notesUrl),
                d3.json(infoUrl)
            ]);

            const maxTime = d3.max(notes, d => Number(d.time_start_sec) + Number(d.duration_sec || 0)) || 0;
            const audioPlayer = await new Promise((resolve) => {
                if (!audioUrl) {
                    resolve(null);
                    return;
                }
                const player = new Tone.Player({
                    url: audioUrl,
                    autostart: false
                }).toDestination();

                const settle = (value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                };

                const timeoutId = window.setTimeout(() => settle(player), 300);
                player.onload = () => settle(player);
                player.onerror = () => settle(null);
            });

            if (selectionToken !== activeSelectionToken) {
                if (audioPlayer && typeof audioPlayer.dispose === 'function') {
                    try { audioPlayer.dispose(); } catch (error) { console.warn('Failed to dispose stale audio player', error); }
                }
                return;
            }

            activeAudioPlayer = audioPlayer;
            activeTrackName = fileName;
            activeAudioUrl = audioUrl;
            window.__VISUALIZER_TRACK_NAME__ = fileName;
            window.__VISUALIZER_AUDIO_URL__ = audioUrl;
            bindTransportToAudio();
            const callbacks = createToggleCallbacks();
            activePlaybackHandler = () => handlePlayback(activeAudioPlayer);
            bindPlayButton(activePlaybackHandler);

            if (window.FILE_PATHS) {
                window.FILE_PATHS.FILENAME = fileName;
            }

            if (typeof window.initVisualizer === 'function') {
                window.initVisualizer('#visualizer-canvas', notes, info, maxTime, audioPlayer, callbacks);
                setStatus(`${fileName}`);
            } else {
                setStatus('Visualizer initialization failed');
            }
        } catch (error) {
            console.error('Failed to load visualizer data', error);
            setStatus('Failed to load selected data');
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (!selectEl) return;

        try {
            const manifest = await d3.json('./data/manifest.json');
            selectEl.innerHTML = manifest.map(name => `<option value="${name}">${name}</option>`).join('');
            selectEl.value = manifest[0];
            selectEl.addEventListener('change', event => {
                loadSelection(event.target.value);
            });

            bindPlayButton(() => handlePlayback(activeAudioPlayer));
            requestAnimationFrame(() => {
                loadSelection(manifest[0]);
            });
        } catch (error) {
            console.error('Failed to load manifest', error);
            setStatus('Failed to load manifest');
        }
    });
})();
