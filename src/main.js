let sharedState = {
    dataMeta: [],
    selectedData: null,
    notes: [],
    info: {},
    maxTime: 0,
    audioPlayer: null,
    allAssetsLoaded: false
};

const DEFAULT_RATIOS = { b: 0.22, c: 0.22, d: 0.56 };
const VIEW_HEIGHTS = { b: 20, c: 20, d: 60 };
const MIN_PANEL_HEIGHT_PX = 30;
let resizeRedrawFrame = null;
let hasAutoFitInit = false;
let panelResizeObserver = null;
const lastObservedSizes = {};

function ensureScrollRoom() {
    const dContainer = document.getElementById('view-D-container');
    if (!dContainer) return;
    // 先清零，避免 min-height 被只增不减
    document.body.style.minHeight = '0px';
    document.documentElement.style.minHeight = '0px';

    const bottom = dContainer.getBoundingClientRect().bottom + window.scrollY;
    const targetHeight = Math.max(window.innerHeight, Math.ceil(bottom + 20)); // padding for footer space
    document.body.style.minHeight = `${targetHeight}px`;
    document.documentElement.style.minHeight = `${targetHeight}px`;
}

function autoFitInitialHeights() {
    const main = document.getElementById('main-content');
    const handleBC = document.getElementById('resize-handle-bc');
    const handleCD = document.getElementById('resize-handle-cd');
    if (!main || !handleBC || !handleCD) return;

    const styles = getComputedStyle(main);
    const gap = parseFloat(styles.gap || '0');
    const handles = (handleBC.getBoundingClientRect().height || 10) + (handleCD.getBoundingClientRect().height || 10);
    const available = main.clientHeight - gap * 2 - handles;
    if (available <= 0) return;

    const minTotal = MIN_PANEL_HEIGHT_PX * 3;
    const usable = Math.max(available, minTotal);

    const bPx = Math.max(MIN_PANEL_HEIGHT_PX, usable * DEFAULT_RATIOS.b);
    const cPx = Math.max(MIN_PANEL_HEIGHT_PX, usable * DEFAULT_RATIOS.c);
    let dPx = Math.max(MIN_PANEL_HEIGHT_PX, usable - bPx - cPx);

    const sumPx = bPx + cPx + dPx;
    VIEW_HEIGHTS.b = (bPx / sumPx) * 100;
    VIEW_HEIGHTS.c = (cPx / sumPx) * 100;
    VIEW_HEIGHTS.d = 100 - VIEW_HEIGHTS.b - VIEW_HEIGHTS.c;

    applyViewHeights();
    hasAutoFitInit = true;
}

function applyViewHeights() {
    const root = document.documentElement;
    root.style.setProperty('--view-b-height', `${VIEW_HEIGHTS.b}%`);
    root.style.setProperty('--view-c-height', `${VIEW_HEIGHTS.c}%`);
    root.style.setProperty('--view-d-height', `${VIEW_HEIGHTS.d}%`);
}

function scheduleRedrawAfterResize() {
    if (resizeRedrawFrame) cancelAnimationFrame(resizeRedrawFrame);
    // 两帧后执行，确保最新的容器尺寸已稳定
    resizeRedrawFrame = requestAnimationFrame(() => {
        resizeRedrawFrame = requestAnimationFrame(() => {
            resizeRedrawFrame = null;
            if (!sharedState.allAssetsLoaded || !sharedState.notes.length) return;
            if (typeof drawViewB === 'function') drawViewB(sharedState.notes, sharedState.maxTime, "#view-B-dataviz", sharedState.info);
            if (typeof drawViewC === 'function') drawViewC(sharedState.notes, sharedState.maxTime, "#view-C-dataviz");
            if (typeof initViewD === 'function') {
                initViewD("#view-D-dataviz", sharedState.notes, sharedState.info, sharedState.maxTime, sharedState.audioPlayer, {
                    togglePlayback,
                    setupAutoStop
                });
            }
            ensureScrollRoom();
        });
    });
}

function setupVerticalResizer(handleId, topId, bottomId, topKey, bottomKey) {
    const handleEl = document.getElementById(handleId);
    const topEl = document.getElementById(topId);
    const bottomEl = document.getElementById(bottomId);
    if (!handleEl || !topEl || !bottomEl) return;

    let startY = 0;
    let startTopHeight = 0;
    let startBottomHeight = 0;
    let pairTotalPercent = 0;
    let pairTotalPx = 0;

    const onPointerMove = (event) => {
        const delta = event.clientY - startY;
        let newTopPx = startTopHeight + delta;
        let newBottomPx = startBottomHeight - delta;
        const minPx = Math.min(MIN_PANEL_HEIGHT_PX, pairTotalPx / 2);

        if (newTopPx < minPx) {
            newTopPx = minPx;
            newBottomPx = pairTotalPx - newTopPx;
        }
        if (newBottomPx < minPx) {
            newBottomPx = minPx;
            newTopPx = pairTotalPx - newBottomPx;
        }

        const newTopPercent = pairTotalPercent * (newTopPx / pairTotalPx);
        const newBottomPercent = pairTotalPercent - newTopPercent;

        VIEW_HEIGHTS[topKey] = newTopPercent;
        VIEW_HEIGHTS[bottomKey] = newBottomPercent;
        applyViewHeights();
        scheduleRedrawAfterResize();
    };

    const onPointerUp = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        handleEl.classList.remove('active');
        scheduleRedrawAfterResize();
    };

    const onPointerDown = (event) => {
        event.preventDefault();
        startY = event.clientY;
        startTopHeight = topEl.getBoundingClientRect().height;
        startBottomHeight = bottomEl.getBoundingClientRect().height;
        pairTotalPx = startTopHeight + startBottomHeight;
        if (pairTotalPx <= 0) return;
        pairTotalPercent = VIEW_HEIGHTS[topKey] + VIEW_HEIGHTS[bottomKey];
        handleEl.classList.add('active');
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    };

    handleEl.addEventListener('pointerdown', onPointerDown);
}

function setupLeftPanelResizer() {
    const handleEl = document.getElementById('resize-handle-a');
    const topEl = document.getElementById('view-A-dataviz');
    const bottomEl = document.getElementById('info-controls');
    const container = document.getElementById('view-A-container');
    if (!handleEl || !topEl || !bottomEl || !container) return;

    let startY = 0;
    let startTopHeight = 0;
    let startBottomHeight = 0;
    let containerHeight = 0;
    let handleHeight = 0;

    const onPointerMove = (event) => {
        const delta = event.clientY - startY;
        let newTopHeight = startTopHeight + delta;
        let newBottomHeight = startBottomHeight - delta;
        const minHeight = 100; // 最小高度（降低以允许更多向上拖动，显示底部图例）

        // 计算可用高度（容器高度减去标题和padding）
        const titleEl = container.querySelector('.view-title');
        const titleHeight = titleEl ? titleEl.getBoundingClientRect().height : 0;
        const containerPadding = 20; // 上下padding总和
        const availableHeight = containerHeight - titleHeight - containerPadding - handleHeight;

        if (newTopHeight < minHeight) {
            newTopHeight = minHeight;
            newBottomHeight = availableHeight - newTopHeight;
        }
        if (newBottomHeight < minHeight) {
            newBottomHeight = minHeight;
            newTopHeight = availableHeight - newBottomHeight;
        }

        // 确保不超过可用高度
        if (newTopHeight + newBottomHeight > availableHeight) {
            const ratio = availableHeight / (newTopHeight + newBottomHeight);
            newTopHeight *= ratio;
            newBottomHeight *= ratio;
        }

        topEl.style.flex = `0 0 ${newTopHeight}px`;
        bottomEl.style.flex = `0 1 auto`;
        bottomEl.style.minHeight = `${newBottomHeight}px`;
    };

    const onPointerUp = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        handleEl.classList.remove('active');
    };

    const onPointerDown = (event) => {
        event.preventDefault();
        startY = event.clientY;
        startTopHeight = topEl.getBoundingClientRect().height;
        startBottomHeight = bottomEl.getBoundingClientRect().height;
        handleHeight = handleEl.getBoundingClientRect().height;
        containerHeight = container.getBoundingClientRect().height;
        handleEl.classList.add('active');
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    };

    handleEl.addEventListener('pointerdown', onPointerDown);
}

function setupResizablePanels() {
    const hasLegacyLayout = Boolean(document.getElementById('view-B-container') && document.getElementById('view-C-container') && document.getElementById('view-D-container'));
    if (!hasLegacyLayout) return;

    applyViewHeights();
    setupVerticalResizer('resize-handle-bc', 'view-B-container', 'view-C-container', 'b', 'c');
    setupVerticalResizer('resize-handle-cd', 'view-C-container', 'view-D-container', 'c', 'd');
    setupLeftPanelResizer();
    setupPanelResizeObservers();
}

function setupPanelResizeObservers() {
    const ids = ['view-B-container', 'view-C-container', 'view-D-container'];
    if (panelResizeObserver) {
        panelResizeObserver.disconnect();
        panelResizeObserver = null;
    }
    if (!window.ResizeObserver) return;
    panelResizeObserver = new ResizeObserver((entries) => {
        let changed = false;
        entries.forEach(entry => {
            const { width, height } = entry.contentRect;
            const key = entry.target.id || Math.random();
            const prev = lastObservedSizes[key];
            if (!prev || prev.w !== width || prev.h !== height) {
                lastObservedSizes[key] = { w: width, h: height };
                changed = true;
            }
        });
        if (changed) scheduleRedrawAfterResize();
    });
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) panelResizeObserver.observe(el);
    });
}

const statusButton = d3.select("#playPauseBtn");
const nowPlayingLabel = d3.select("#current-track-title");

// --- Helpers -------------------------------------------------------

async function setupAudioPlayer(url) {
    return new Promise(resolve => {
        const silentStub = {
            start: () => { }, stop: () => { }, pause: () => { }, loaded: true, state: 'stopped'
        };
        if (!url) {
            resolve(silentStub);
            return;
        }
        const player = new Tone.Player({
            url,
            autostart: false,
            onload: () => {
                player.loaded = true;
                resolve(player);
            },
            onerror: (e) => {
                console.warn(`Audio loading failed from path: ${url}. Proceeding without audio.`, e);
                resolve(silentStub);
            }
        }).toDestination();
    });
}

function stripExtension(name) {
    return name.replace(/\.midi?$/i, "").replace(CONFIG.INFO_SUFFIX, "");
}

function safeDecode(text) {
    try {
        return decodeURIComponent(text);
    } catch (e) {
        return text;
    }
}

async function tryFetchManifest(path) {
    try {
        const data = await d3.json(path);
        if (Array.isArray(data)) return data;
    } catch (e) {
        // ignore
    }
    return [];
}

async function fetchDirListing(dir, exts = []) {
    try {
        const html = await d3.text(dir);
        const hrefs = [];
        const regex = /href="([^"]+)"/gi;
        let m;
        while ((m = regex.exec(html)) !== null) {
            hrefs.push(m[1]);
        }
        const filtered = hrefs.filter(h => exts.some(ext => h.toLowerCase().endsWith(ext.toLowerCase())));
        return filtered.map(h => stripExtension(safeDecode(h)));
    } catch (e) {
        return [];
    }
}

async function discoverDataEntries() {
    const normalizeBaseNames = (list) => Array.from(new Set((list || []).map(safeDecode)));

    // 1) manifest.json 优先
    const manifestList = await tryFetchManifest(CONFIG.MANIFEST_JSON);
    let baseNames = normalizeBaseNames(manifestList);

    // 2) 尝试 csv 目录下的 *_info.json
    if (!baseNames || baseNames.length === 0) {
        const infoBases = await fetchDirListing("../data/processed/", [CONFIG.INFO_SUFFIX]);
        baseNames = normalizeBaseNames(infoBases);
    }

    // 3) 回退 data/ 下的 midi 列表
    if (!baseNames || baseNames.length === 0) {
        baseNames = normalizeBaseNames(await fetchDirListing("../data/midi/", [".mid", ".midi"]));
    }

    baseNames = normalizeBaseNames(baseNames);

    // 4) 最终兜底：使用 config 中的默认文件名
    if (!baseNames.length && FILE_PATHS?.FILENAME) {
        baseNames = [FILE_PATHS.FILENAME];
    }

    const metas = [];
    for (const base of baseNames) {
        const infoPath = `../data/processed/${encodeURIComponent(base)}${CONFIG.INFO_SUFFIX}`;
        const notesPath = `../data/processed/${encodeURIComponent(base)}${CONFIG.CSV_SUFFIX}`;
        const audioPath = `../public/mp3/${encodeURIComponent(base)}${CONFIG.DEFAULT_AUDIO_EXT}`;
        try {
            const info = await d3.json(infoPath);
            metas.push({
                id: base,
                baseName: base,
                infoPath,
                notesPath,
                audioPath,
                ...info
            });
        } catch (e) {
            console.warn(`Skip ${base}: cannot load info json at ${infoPath}`);
        }
    }
    return metas;
}

function normalizeNotes(notes) {
    const timeOffset = d3.min(notes, d => d.time_start_sec) || 0;
    if (timeOffset > 0) {
        notes.forEach(d => { d.time_start_sec -= timeOffset; });
    }
    notes.forEach(d => {
        d.time_start_sec = +d.time_start_sec;
        d.duration_sec = +d.duration_sec;
        d.pitch = +d.pitch;
        d.velocity = +d.velocity;
        d.track_new = d.track_new ? d.track_new.trim() : "Default";
        d.time_end_sec = d.time_start_sec + d.duration_sec;
    });
    return notes;
}

function updateDocumentTitle(meta) {
    const titleText = meta?.title || meta?.baseName || "Visualization";
    document.title = titleText;
    const docTitle = document.getElementById('docTitle');
    if (docTitle) docTitle.textContent = `${titleText} - Visualization`;
}

function setNowPlaying(text) {
    if (nowPlayingLabel && !nowPlayingLabel.empty()) {
        nowPlayingLabel.text(text);
    }
}

function renderNowPlaying(meta, prefix = "Now Playing") {
    const title = meta?.title || meta?.baseName || "Unknown";
    const artist = meta?.artist ? ` · ${meta.artist}` : "";
    setNowPlaying(`${prefix}: ${title}${artist}`);
}

function startAudioAtCurrentTransportTime() {
    const player = sharedState.audioPlayer;
    if (!player || typeof player.start !== 'function') return;
    try {
        if (typeof player.stop === 'function') player.stop();
        const offset = Math.max(0, Tone.Transport.seconds);
        player.start(undefined, offset);
    } catch (e) {
        console.warn("Failed to start audio in sync with transport", e);
    }
}

function stopAudioPlayback() {
    const player = sharedState.audioPlayer;
    if (!player || typeof player.stop !== 'function') return;
    try {
        player.stop();
    } catch (e) {
        console.warn("Failed to stop audio playback", e);
    }
}

// --- Data loading & view wiring -----------------------------------

async function loadTrackData(meta) {
    statusButton.text(`Loading ${meta.title || meta.baseName} ...`);
    renderNowPlaying(meta, "Loading");
    Tone.Transport.stop();
    if (sharedState.audioPlayer?.stop) sharedState.audioPlayer.stop();

    let notes = [];
    let info = meta;
    try {
        [notes, info] = await Promise.all([
            d3.csv(meta.notesPath, d3.autoType),
            d3.json(meta.infoPath)
        ]);
    } catch (e) {
        console.error(`Load failed for ${meta.baseName}`, e);
        statusButton.text("❌ Data Load Failed");
        setNowPlaying("❌ Data Load Failed");
        return;
    }
    if (!notes || notes.length === 0) {
        statusButton.text("❌ No notes in CSV");
        setNowPlaying("❌ No notes in CSV");
        return;
    }

    notes = normalizeNotes(notes);
    sharedState.notes = notes;
    sharedState.info = info;
    sharedState.maxTime = d3.max(notes, d => d.time_end_sec) + CONFIG.END_DELAY_SECONDS;

    Tone.Transport.bpm.value = info.bpm || 120;
    Tone.Transport.timeSignature = [info.numerator || 4, info.denominator || 4];
    Tone.Transport.stop();

    sharedState.audioPlayer = await setupAudioPlayer(meta.audioPath);
    sharedState.selectedData = meta;
    updateDocumentTitle(meta);
    renderNowPlaying(meta);

    d3.select("#rhythm-info").text(`BPM: ${Tone.Transport.bpm.value.toFixed(1)} | Time Signature: ${Tone.Transport.timeSignature[0]}/${Tone.Transport.timeSignature[1]}`);

    if (typeof initViewD === 'function') {
        initViewD("#view-D-dataviz", sharedState.notes, sharedState.info, sharedState.maxTime, sharedState.audioPlayer, {
            togglePlayback: togglePlayback,
            setupAutoStop: setupAutoStop
        });
    }
    if (typeof drawViewB === 'function') drawViewB(sharedState.notes, sharedState.maxTime, "#view-B-dataviz", sharedState.info);
    if (typeof drawViewC === 'function') drawViewC(sharedState.notes, sharedState.maxTime, "#view-C-dataviz");

    setupTransportListeners();
    sharedState.allAssetsLoaded = true;
    statusButton.text("▶ Play (Ready)");

    if (!hasAutoFitInit) {
        requestAnimationFrame(() => {
            autoFitInitialHeights();
            scheduleRedrawAfterResize();
        });
    } else {
        ensureScrollRoom();
    }
}

async function bootstrap() {
    const hasLegacyLayout = Boolean(document.getElementById('view-A-container') && document.getElementById('view-B-container') && document.getElementById('view-C-container'));
    if (!hasLegacyLayout) {
        return;
    }

    statusButton.text("Loading all data...");
    setNowPlaying("Loading...");
    const dataMeta = await discoverDataEntries();
    sharedState.dataMeta = dataMeta;
    if (!dataMeta.length) {
        statusButton.text("❌ No data entries found");
        return;
    }

    if (typeof drawViewA === 'function') {
        drawViewA(dataMeta, "#view-A-dataviz", { onSelect: loadTrackData });
    }

    await loadTrackData(dataMeta[0]);

    window.addEventListener('timejump', handleTimeJump);
    window.addEventListener('resize', () => {
        if (typeof drawViewA === 'function') drawViewA(dataMeta, "#view-A-dataviz", { onSelect: loadTrackData });
        scheduleRedrawAfterResize();
    });
}

// --- Transport & controls -----------------------------------------

function setupAutoStop() {
    if (typeof setupAutoStopD === 'function') {
        setupAutoStopD();
    }
}

async function togglePlayback() {
    if (!sharedState.allAssetsLoaded) return;
    if (Tone.context.state !== 'running') { await Tone.start(); }

    if (Tone.Transport.state === 'started') {
        Tone.Transport.pause();
    } else {
        Tone.Transport.start();
        setupAutoStop();
    }
}

// 全局动画循环，用于持续更新 View B 和 View C 的 Playhead
let globalAnimationFrameId = null;

function animateGlobal() {
    if (Tone.Transport.state === 'started') {
        // 每一帧都更新 View B 和 View C 的 Playhead
        // View D 可能有自己的优化逻辑，但 View B/C 需要每一帧都动
        if (typeof updateVizB === 'function') {
            updateVizB(Tone.Transport.seconds, false, false);
        }
        if (typeof updateVizC === 'function') {
            updateVizC(Tone.Transport.seconds, false, false);
        }
        globalAnimationFrameId = requestAnimationFrame(animateGlobal);
    }
}

function setupTransportListeners() {
    Tone.Transport.off('start');
    Tone.Transport.off('pause');
    Tone.Transport.off('stop');

    Tone.Transport.on('start', () => {
        updateAllViews(false, false);
        d3.select("#playPauseBtn").text("❚❚ Pause");
        startAudioAtCurrentTransportTime();
        // 启动全局动画循环
        if (globalAnimationFrameId) cancelAnimationFrame(globalAnimationFrameId);
        animateGlobal();
    });

    Tone.Transport.on('pause', () => {
        updateAllViews(false, false);
        d3.select("#playPauseBtn").text("▶ Play");
        stopAudioPlayback();
        // 停止全局动画循环
        if (globalAnimationFrameId) {
            cancelAnimationFrame(globalAnimationFrameId);
            globalAnimationFrameId = null;
        }
    });

    Tone.Transport.on('stop', () => {
        Tone.Transport.seconds = 0;
        updateAllViews(true, false);
        d3.select("#playPauseBtn").text("⟲ Replay");
        stopAudioPlayback();
        // 停止全局动画循环
        if (globalAnimationFrameId) {
            cancelAnimationFrame(globalAnimationFrameId);
            globalAnimationFrameId = null;
        }
    });
}

function updateAllViews(isStopping, skipGlow) {
    if (typeof updateVizB === 'function') updateVizB(Tone.Transport.seconds, isStopping, skipGlow);
    if (typeof updateVizC === 'function') updateVizC(Tone.Transport.seconds, isStopping, skipGlow);
    if (typeof updateVizD === 'function') updateVizD(isStopping, skipGlow);
}

// 防止递归调用的标志
let isHandlingTimeJump = false;

function handleTimeJump(e) {
    // 防止递归调用（仍然需要，防止意外循环）
    if (isHandlingTimeJump) {
        return;
    }

    const currentTime = e.detail.time;

    // 注意：viewB 和 viewD 在触发 timejump 事件前已经设置了 Transport.seconds
    // 所以这里不需要再次设置，只需要：
    // 1. 确保 Transport.seconds 是正确的（容错检查）
    // 2. 更新其他视图（View C 等）
    // 3. 同步音频播放位置

    isHandlingTimeJump = true;
    try {
        // 容错：如果值不一致（不应该发生，但以防万一），进行修正
        if (Math.abs(Tone.Transport.seconds - currentTime) > 0.01) {
            Tone.Transport.seconds = currentTime;
        }

        // 更新其他视图（View C 等，View B 和 View D 已经在触发事件前更新过了）
        if (typeof updateVizC === 'function') updateVizC(currentTime, false, true);

        // 如果正在播放，同步音频位置
        if (Tone.Transport.state === 'started') startAudioAtCurrentTransportTime();
    } finally {
        // 使用 setTimeout 确保在下一个事件循环中重置标志
        setTimeout(() => {
            isHandlingTimeJump = false;
        }, 0);
    }
}

// 全局键盘快捷键：Space 键切换播放
document.addEventListener('keydown', (event) => {
    // 只在 Space 键且不在输入框中时触发
    if (event.code === 'Space' || event.key === ' ') {
        const target = event.target;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        if (!isInput) {
            event.preventDefault(); // 防止页面滚动
            togglePlayback();
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    setupResizablePanels();
    bootstrap();
});