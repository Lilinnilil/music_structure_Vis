(function () {
    window.__VIEWD_STANDALONE__ = true;

    const selectEl = document.getElementById('viewd-file-select');
    const statusEl = document.getElementById('current-track-title');
    let activePlaybackHandler = null;
    let activeAudioPlayer = null;
    let activeTrackName = null;
    let activeAudioUrl = null;
    let activeSelectionToken = 0;
    let standalonePlaybackActive = false;
    let standalonePlaybackOffset = 0;
    let standalonePlaybackStartedAt = 0;
    let standaloneAnimationFrameId = null;

    function setStatus(message) {
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    function updatePlayButtonLabel(state) {
        const playButton = document.getElementById('playPauseBtn');
        if (!playButton) return;
        playButton.textContent = state === 'started' ? '⏸ Pause' : '▶ Play';
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

    function stopStandalonePlaybackLoop() {
        if (standaloneAnimationFrameId !== null) {
            cancelAnimationFrame(standaloneAnimationFrameId);
            standaloneAnimationFrameId = null;
        }
    }

    function startStandalonePlaybackLoop() {
        if (standaloneAnimationFrameId !== null) {
            cancelAnimationFrame(standaloneAnimationFrameId);
        }

        const tick = (timestamp) => {
            if (!standalonePlaybackActive) return;
            const elapsed = (timestamp - standalonePlaybackStartedAt) / 1000;
            Tone.Transport.seconds = standalonePlaybackOffset + elapsed;
            if (typeof window.updateVizD === 'function') {
                window.updateVizD(false, false);
            }
            standaloneAnimationFrameId = requestAnimationFrame(tick);
        };

        standalonePlaybackStartedAt = performance.now();
        standaloneAnimationFrameId = requestAnimationFrame(tick);
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

        if (standalonePlaybackActive) {
            standalonePlaybackActive = false;
            window.__VIEWD_STANDALONE_PLAYBACK_ACTIVE__ = false;
            standalonePlaybackOffset = transport.seconds || standalonePlaybackOffset;
            stopStandalonePlaybackLoop();
            stopCurrentAudioPlayer();
            transport.pause();
            setStatus('Paused');
            updatePlayButtonLabel('paused');
            if (typeof window.updateVizD === 'function') {
                window.updateVizD(false, false);
            }
            return;
        }

        standalonePlaybackActive = true;
        window.__VIEWD_STANDALONE_PLAYBACK_ACTIVE__ = true;
        standalonePlaybackOffset = Math.max(0, transport.seconds || 0);
        if (transport.state === 'stopped') {
            transport.seconds = standalonePlaybackOffset;
        }
        if (transport.state !== 'started') {
            transport.start();
        }
        if (activeAudioPlayer && typeof activeAudioPlayer.start === 'function') {
            try {
                stopCurrentAudioPlayer();
                activeAudioPlayer.start(undefined, standalonePlaybackOffset);
            } catch (error) {
                console.warn('Failed to sync standalone audio start', error);
            }
        }
        setStatus('Playing');
        updatePlayButtonLabel('started');
        startStandalonePlaybackLoop();
        if (typeof window.updateVizD === 'function') {
            window.updateVizD(false, false);
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
            playButton.textContent = '▶ Play';
        }
    }

    async function loadSelection(fileName) {
        const selectionToken = ++activeSelectionToken;
        const notesUrl = `./data/processed/${encodeURIComponent(fileName)}_notes_clean.csv`;
        const infoUrl = `./data/processed/${encodeURIComponent(fileName)}_info.json`;
        const audioUrl = `./public/mp3/${encodeURIComponent(fileName)}.mp3`;

        stopCurrentAudioPlayer();
        disposeCurrentAudioPlayer();
        standalonePlaybackActive = false;
        window.__VIEWD_STANDALONE_PLAYBACK_ACTIVE__ = false;
        stopStandalonePlaybackLoop();
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
            window.__VIEWD_STANDALONE_TRACK_NAME__ = fileName;
            window.__VIEWD_STANDALONE_AUDIO_URL__ = audioUrl;
            bindTransportToAudio();
            const callbacks = createToggleCallbacks();
            activePlaybackHandler = () => handlePlayback(activeAudioPlayer);
            bindPlayButton(activePlaybackHandler);

            if (window.FILE_PATHS) {
                window.FILE_PATHS.FILENAME = fileName;
            }

            if (typeof window.initViewD === 'function') {
                window.initViewD('#view-D-dataviz', notes, info, maxTime, audioPlayer, callbacks);
                setStatus(`${fileName}`);
            } else {
                setStatus('ViewD initialization failed');
            }
        } catch (error) {
            console.error('Failed to load standalone ViewD data', error);
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
