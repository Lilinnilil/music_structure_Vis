audioPlayer = null; 
allAssetsLoaded = false;
vizUpdateLoop = null;
transportScheduleId = null;
currentTranslationX = 0;
fullChartWidth = 0;
minTranslationX = 0;
maxTranslationX = 0;
currentTime = 0;
originalMaxTime = 0;
beatDurationSec = 0;
barDurationSec = 0;
currentBPM = 120;
beatNumerator = 4;
let viewDNotes = [];
let lineAnchorCache = [];
let lineAnchorByTrack = new Map();
let lineAnchorsDirty = true;
let rhythmPercussionOverlays = null;
let showPercussion = true;
let showRhythmWheel = true; // 控制节奏轮和小节线的显示
function isPercussionTrack(trackName) {
    if (!trackName) return false;
    const t = trackName.toLowerCase();
    const keywords = [
        'drum', 'percussion', 'tinkle bell', 'agogo',
        'steel drums', 'woodblock', 'taiko drum',
        'melodic tom', 'synth drum', 'reverse cymbal', 'kit'
    ];
    return keywords.some(kw => t.includes(kw));
}

togglePlaybackCallback = () => console.error("Toggle playback callback not set in viewD.");

// Track stroke-width mapping (adjustable)
const TRACK_MIN_STROKE = 0.8;
const TRACK_MAX_STROKE = 5.0;

colorScale = null;
xScale = null;
yScale = null; 
xAxisGroup = null;
yAxisGroup = null;
timeLabel = null;
rhythmPolygon = null;
beatPoints = null;
displayMode = 0;
statusButton = d3.select("#playPauseBtn");
toggleDisplayModeButton = d3.select("#toggleDisplayModeBtn");
togglePercussionButton = d3.select("#togglePercussionBtn");
toggleRhythmWheelButton = d3.select("#toggleRhythmWheelBtn");
xScrollbar = document.getElementById("x-scrollbar");

TRANSLATION_PIXEL_RANGE = 0;
svg = null;
playheadX = 0;
chartGroup = null;
barLabelGroup = null;

function setupDefs() {
    const defs = svg.append("defs");

    // 播放头渐变
    const playheadGradient = defs.append("linearGradient")
        .attr("id", "playheadGradient")
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
    playheadGradient.append("stop").attr("offset", "0%").attr("stop-color", CONFIG.HIGHLIGHT_COLOR).attr("stop-opacity", 0.1);
    playheadGradient.append("stop").attr("offset", "100%").attr("stop-color", CONFIG.PLAYHEAD_COLOR).attr("stop-opacity", 0.9);

    // 辉光滤镜
    const filter = defs.append("filter")
        .attr("id", "glow")
        .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");
}

function drawPlayhead() {
    svg.append("rect")
        .attr("x", playheadX - 1)
        .attr("y", 0)
        .attr("width", 2)
        .attr("height", CONFIG.DRAWING_HEIGHT)
        .attr("fill", "url(#playheadGradient)");
}

function drawRhythmWheel() {
    const container = d3.select("#rhythm-viz");
    const containerNode = container.node();
    const padding = 12; // 留出边距，防止描边被裁切
    const fallbackSize = CONFIG.RHYTHM_RADIUS * 2 + padding * 2;
    const availableW = containerNode ? Math.max(containerNode.clientWidth || 0, fallbackSize) : fallbackSize;
    const availableH = containerNode ? Math.max(containerNode.clientHeight || 0, fallbackSize) : fallbackSize;
    const usableSize = Math.max(140, Math.min(availableW, availableH));
    const radius = Math.max(32, Math.min(CONFIG.RHYTHM_RADIUS, (usableSize / 2) - padding));
    const svgSize = Math.max(usableSize, radius * 2 + padding * 2);
    const center = svgSize / 2;

    container.select('svg').remove();
    const rhythmSVG = container
        .append("svg")
        .attr("width", svgSize)
        .attr("height", svgSize)
        .attr("viewBox", `0 0 ${svgSize} ${svgSize}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .append("g")
        .attr("transform", `translate(${center}, ${center})`);

    rhythmSVG.append("circle")
        .attr("class", "rhythm-beat-circle")
        .attr("r", radius);
        
    rhythmSVG.selectAll(".rhythm-polygon, .rhythm-beat-point").remove();

    const totalBeats = beatNumerator;
    const pointsData = d3.range(totalBeats).map(i => {
        const angle = (i / totalBeats) * (2 * Math.PI);
        return getCoords(angle, radius);
    });

    if (beatNumerator >= 3) {
        const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveLinearClosed);
        rhythmPolygon = rhythmSVG.append("path")
            .attr("class", "rhythm-polygon")
            .attr("d", line(pointsData))
            .style("stroke", "white")
            .style("stroke-width", "1.5px")
            .style("fill", "none");
    } else if (beatNumerator === 2) {
        // For 2/2 或 2/4 拍：使用一条直径白线代替多边形
        const [p1, p2] = pointsData;
        rhythmPolygon = rhythmSVG.append("line")
            .attr("class", "rhythm-polygon")
            .attr("x1", p1.x).attr("y1", p1.y)
            .attr("x2", p2.x).attr("y2", p2.y)
            .style("stroke", "white")
            .style("stroke-width", "1.5px")
            .style("fill", "none");
    } else {
        rhythmPolygon = null;
    }

    const beatPointRadius = Math.max(4, radius * 0.07);
    const overlayRadius = Math.max(7, beatPointRadius + 4);

    beatPoints = rhythmSVG.selectAll(".rhythm-beat-point")
        .data(pointsData)
        .enter().append("circle")
        .attr("class", "rhythm-beat-point")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", beatPointRadius);
    
    rhythmPercussionOverlays = rhythmSVG.selectAll(".percussion-beat-overlay")
        .data(pointsData)
        .enter().append("circle")
        .attr("class", "percussion-beat-overlay")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", overlayRadius)
        .style("display", "none");

    // Ensure the yellow beat points render above the percussion halo,
    // while the halo stays above the base rhythm wheel.
    rhythmPercussionOverlays.raise();
    beatPoints.raise();
        
    rhythmSVG.attr("transform", `translate(${center}, ${center})`);
}

function drawLegend(trackNames) {
    const legendContainer = d3.select("#legend");
    legendContainer.selectAll(".legend-item").remove();
    // 分离 percussion 和 melodic tracks
    const percussionTracks = trackNames.filter(isPercussionTrack);
    const melodicTracks = trackNames.filter(t => !isPercussionTrack(t));
    // Melodic tracks
    const melodicItems = legendContainer.selectAll(".legend-item")
        .data(melodicTracks)
        .enter()
        .append("div")
        .attr("class", "legend-item");
    melodicItems.append("div")
        .attr("class", "legend-color")
        .style("background-color", d => colorScale(d));
    melodicItems.append("span").text(d => d);
    // Percussion tracks（白色）
    const percussionItems = legendContainer.selectAll(".legend-item-percussion")
        .data(percussionTracks)
        .enter()
        .append("div")
        .attr("class", "legend-item legend-item-percussion");
    percussionItems.append("div")
        .attr("class", "legend-color")
        .style("background-color", "white");
    percussionItems.append("span").text(d => d);
    // 初始状态使所有图例灰度/低透明度
    legendContainer.selectAll('.legend-item').style('opacity', 0.35).style('filter', 'grayscale(60%)');
}

// --- Rhythmic Group Identification Helper Function ---
function identifyRhythmicGroups(notesArray) {
    // Heuristics parameters (prefer CONFIG values when available)
    const MIN_NOTES_IN_GROUP = (CONFIG.RHYTHMIC_MIN_NOTES_IN_GROUP !== undefined) ? CONFIG.RHYTHMIC_MIN_NOTES_IN_GROUP : 2;
    const MAX_GROUP_DURATION_SEC = (CONFIG.RHYTHMIC_MAX_GROUP_DURATION_SEC !== undefined) ? CONFIG.RHYTHMIC_MAX_GROUP_DURATION_SEC : 0.35;
    const TIME_TOLERANCE_SEC = (CONFIG.RHYTHMIC_TIME_TOLERANCE_FOR_GROUP !== undefined) ? CONFIG.RHYTHMIC_TIME_TOLERANCE_FOR_GROUP : 0.05; // notes starting within this are considered simultaneous
    const MIN_REPEATS = (CONFIG.RHYTHMIC_MIN_REPEATS !== undefined) ? CONFIG.RHYTHMIC_MIN_REPEATS : 3; // minimum number of repeats to call a pattern 'rhythmic'
    const INTERVAL_TO_DURATION_RATIO = (CONFIG.RHYTHMIC_INTERVAL_TO_DURATION_RATIO !== undefined) ? CONFIG.RHYTHMIC_INTERVAL_TO_DURATION_RATIO : 2.5; // median interval must be this many times larger than group duration
    const RHYTHM_HIT_TOL = (CONFIG.RHYTHMIC_HIT_TOLERANCE !== undefined) ? CONFIG.RHYTHMIC_HIT_TOLERANCE : 0.08;
    const MIN_ARPEGGIO_SUSTAIN_OVERLAP = 0.02; // small overlap indicating sustain across occurrences

    const melodicNotes = [];
    const rhythmicGroups = []; // final groups flagged as rhythmic

    // Sort by time, then pitch
    notesArray.sort((a, b) => a.time_start_sec - b.time_start_sec || a.pitch - b.pitch);

    // First pass: extract all simultaneous short groups as candidates
    const candidateGroups = [];
    let i = 0;
    while (i < notesArray.length) {
        const currentNote = notesArray[i];
        const group = [currentNote];
        let j = i + 1;

        while (j < notesArray.length && notesArray[j].time_start_sec - currentNote.time_start_sec < TIME_TOLERANCE_SEC) {
            group.push(notesArray[j]);
            j++;
        }

        // Consider simultaneous groups as candidates regardless of note duration.
        // Rationale: allow longer-sustained notes to be recognized as repeated arpeggio/rhythmic groups
        // in later heuristic steps (median interval vs duration). Short-duration-only restriction
        // previously prevented longer arpeggios from being classified correctly.
        if (group.length >= MIN_NOTES_IN_GROUP) {
            candidateGroups.push({ time: currentNote.time_start_sec, notes: group });
        } else {
            group.forEach(n => melodicNotes.push(n));
        }
        i = j;
    }

    // Simplified rule per request: any simultaneous group of >= MIN_NOTES_IN_GROUP within the same track
    // is considered a rhythmic/arpeggio group regardless of interval or duration.
    candidateGroups.forEach(g => {
        rhythmicGroups.push(g.notes);
    });

    return { melodicNotes, rhythmicGroups };
}

// --- Voice Separation Helper Function (for advanced line rendering) ---
function splitIntoVoices(notesArray, maxVoiceGapSec, maxPitchDiff, maxOverlapSec) {
    const voices = []; // Each element is an array of notes (or nulls) for a single voice

    // Sort notes by start time, then by pitch (important for consistent voice assignment)
    notesArray.sort((a, b) => a.time_start_sec - b.time_start_sec || a.pitch - b.pitch);

    // Active voices store the last note played in that voice
    const activeVoices = new Map(); // Map<voiceIndex, lastNoteInVoice>

    notesArray.forEach(note => {
        let bestVoiceIndex = -1;
        let minScore = Infinity; // Lower score is better (closer pitch, recent activity)

        // Try to find an existing voice for the current note
        activeVoices.forEach((lastNoteInVoice, voiceIndex) => {
            const timeGap = note.time_start_sec - lastNoteInVoice.time_end_sec; // Can be negative for overlaps
            const pitchDiff = Math.abs(note.pitch - lastNoteInVoice.pitch);

            // A note can connect if it starts slightly before (within maxOverlapSec) or slightly after (within maxVoiceGapSec) the previous note ends.
            const isWithinAcceptableTimeWindow = (timeGap >= -maxOverlapSec && timeGap < maxVoiceGapSec);

            if (isWithinAcceptableTimeWindow && pitchDiff < maxPitchDiff) {
                // Prioritize smaller absolute time differences and pitch differences
                let score = Math.abs(timeGap) * 10 + pitchDiff; // Use absolute timeGap for scoring
                if (score < minScore) {
                    minScore = score;
                    bestVoiceIndex = voiceIndex;
                }
            }
        });

        if (bestVoiceIndex !== -1) {
            // Assign to existing voice
            voices[bestVoiceIndex].push(note);
            activeVoices.set(bestVoiceIndex, note);
        } else {
            // Create a new voice
            const newVoiceIndex = voices.length;
            voices.push([note]);
            activeVoices.set(newVoiceIndex, note);
        }
        
        // Clean up old active voices (those that have gone silent for too long)
        const currentActiveVoiceKeys = Array.from(activeVoices.keys());
        currentActiveVoiceKeys.forEach(voiceIndex => {
            const lastNote = activeVoices.get(voiceIndex);
            // A voice is considered 'inactive' if the current note starts significantly after its last note ended.
            if (note.time_start_sec - lastNote.time_end_sec > maxVoiceGapSec) {
                activeVoices.delete(voiceIndex);
            }
        });
    });
    
    // Filter out voices that are too short (e.g., single notes that didn't connect)
    return voices.filter(voice => voice.length > 0);
}

function rebuildLineAnchors() {
    if (!yScale) return;
    lineAnchorCache = [];
    lineAnchorByTrack = new Map();
    const pitchFromY = y => yScale ? yScale.invert(y) : y;
    const trackLineData = chartGroup ? chartGroup.selectAll('.track-line').data() : [];
    (trackLineData || []).forEach(d => {
        if (!d || !d.segments) return;
        (d.segments || []).forEach(seg => {
            const entries = [
                { track: d.trackName, time: seg.timeStart, pitch: pitchFromY(seg.y1) },
                { track: d.trackName, time: seg.timeEnd, pitch: pitchFromY(seg.y2) }
            ];
            entries.forEach(e => {
                lineAnchorCache.push(e);
                const arr = lineAnchorByTrack.get(e.track) || [];
                arr.push(e);
                lineAnchorByTrack.set(e.track, arr);
            });
        });
    });
    lineAnchorsDirty = false;
}

function drawPianoRollElements(notes) {
    lineAnchorsDirty = true;
    const min_pitch = d3.min(notes, d => d.pitch);
    const max_pitch = d3.max(notes, d => d.pitch);
    
    // Y 比例尺和音符高度
    yScale = d3.scaleLinear().domain([min_pitch - 1, max_pitch + 1]).range([CONFIG.DRAWING_HEIGHT, 0]);
    const rectHeight = CONFIG.DRAWING_HEIGHT / (max_pitch - min_pitch + 2);
    const pitchRange = d3.range(min_pitch, max_pitch + 1, 1);

    // 清理旧的轴和标签
    svg.selectAll(".axis, .C4-label, .bar-label").remove();

    // 绘制黑键背景
    chartGroup.selectAll(".black-key-bg").data(pitchRange).enter().insert("rect", ":first-child")
        .attr("class", "black-key-bg").attr("y", d => yScale(d + 0.5) - rectHeight / 2).attr("x", 0)
        .attr("width", xScale(originalMaxTime + CONFIG.END_DELAY_SECONDS)).attr("height", rectHeight).filter(d => CONFIG.BLACK_KEYS_INDICES.includes(d % 12));

    // 绘制白键网格线
    chartGroup.selectAll(".grid-line-y").data(pitchRange.filter(d => CONFIG.WHITE_KEY_INDICES.includes(d % 12))).enter().insert("line", ":first-child")
        .attr("class", "grid-line grid-line-y").attr("x1", 0).attr("x2", xScale(originalMaxTime + CONFIG.END_DELAY_SECONDS)).attr("y1", d => yScale(d) + rectHeight / 2).attr("y2", d => yScale(d) + rectHeight / 2);

    // 绘制小节/节拍线
    const beatTicks = d3.range(0, originalMaxTime + CONFIG.END_DELAY_SECONDS, beatDurationSec);
    const barTicks = d3.range(0, originalMaxTime + CONFIG.END_DELAY_SECONDS, barDurationSec);

    chartGroup.selectAll(".beat-line").data(beatTicks).enter().insert("line", ":first-child")
        .attr("class", "beat-line").attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", CONFIG.DRAWING_HEIGHT);

    chartGroup.selectAll(".bar-line").data(barTicks).enter().insert("line", ":first-child")
        .attr("class", "bar-line").attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", CONFIG.DRAWING_HEIGHT);
    
    // 绘制小节标签
    barLabelGroup.selectAll(".bar-label")
        .data(barTicks)
        .enter()
        .append("text")
        .attr("class", "bar-label")
        .attr("x", d => xScale(d) + xScale(barDurationSec) / 2)
        .attr("y", -8)
        .text((d, i) => i + 1)
        .filter(d => d + barDurationSec > originalMaxTime + CONFIG.END_DELAY_SECONDS)
        .remove();

    // 绘制时间轴
    xAxisGroup = svg.append("g").attr("class", "axis x-axis-flow").attr("transform", `translate(0,${CONFIG.DRAWING_HEIGHT})`)
        .call(d3.axisBottom(xScale).tickFormat(d => `${d.toFixed(1)}s`).tickSize(0).tickPadding(10).tickValues(barTicks));

    // 绘制音高轴
    yAxisGroup = svg.append("g").attr("class", "axis y-axis-flow").call(d3.axisLeft(yScale).tickValues(pitchRange.filter(d => CONFIG.WHITE_KEY_INDICES.includes(d % 12))).tickFormat(midi => midiToNoteName(midi)).tickSize(0).tickPadding(8));
    yAxisGroup.selectAll(".tick").filter(d => d === 60).select("text").attr("class", "C4-label");

    // 绘制时间标签
    timeLabel = svg.append("text").attr("x", playheadX).attr("y", CONFIG.DRAWING_HEIGHT + CONFIG.MARGIN.bottom - 10).style("text-anchor", "middle").attr("fill", CONFIG.HIGHLIGHT_COLOR).style("font-size", "14px").style("font-weight", "bold").text("0.00s");

    // 绘制音符矩形
    chartGroup.selectAll(".note")
        .data(notes)
        .join("rect")
        .attr("class", "note")
        .attr("x", d => xScale(d.time_start_sec))
        .attr("y", d => yScale(d.pitch) - rectHeight / 2)
        .attr("width", d => Math.max(1, xScale(d.time_end_sec) - xScale(d.time_start_sec)))
        .attr("height", rectHeight * 0.9)
        .attr("rx", 1.5)
        .attr("ry", 1.5)
        // Use fill-opacity to encode velocity in Piano Roll mode (preserve overall element opacity for glow/styling)
        .attr("fill-opacity", d => 0.4 + (d.velocity || 0) / 127 * 0.6)
        .attr("fill", d => isPercussionTrack(d.track_new) ? "white" : colorScale(d.track_new))
        .attr("data-start", d => d.time_start_sec)
        .attr("data-end", d => d.time_end_sec)
        .attr("data-velocity", d => d.velocity)
        // store base fill-opacity (velocity-encoded) so we can restore it after highlights
        .attr("data-velocity-fill-opacity", d => 0.4 + (d.velocity || 0) / 127 * 0.6)
        .attr("data-track-color", d => isPercussionTrack(d.track_new) ? "white" : colorScale(d.track_new))
        .attr("data-track-color-light", d => isPercussionTrack(d.track_new) ? "white" : lightenColor(colorScale(d.track_new), 2.5))
        .append("title")
        .text(d => `Track: ${d.track_new}\nPitch: ${midiToNoteName(d.pitch)}\n Duriation: ${d.duration_sec.toFixed(2)} s`);


    // --- 绘制音轨连线 ---
    // Keep melodic lines free of percussion: separate notes collection
    const NON_PERCUSSION_NOTES = notes.filter(d => !isPercussionTrack(d.track_new));

    const LONG_ABSENCE_BARS = 0.25;
    const BAR_THRESHOLD = LONG_ABSENCE_BARS * barDurationSec;
    const MIN_ABSOLUTE_THRESHOLD = 0.5;
    const FINAL_THRESHOLD = Math.max(BAR_THRESHOLD, MIN_ABSOLUTE_THRESHOLD);
    
    const notesByTrackAll = d3.group(notes, d => d.track_new);
    const notesByTrack = d3.group(NON_PERCUSSION_NOTES, d => d.track_new);
    
    const allVoiceSegments = []; 
    const allRhythmicGroups = []; // { trackName, time, minPitch, maxPitch, notes }

    // 1) Rhythmic/arpeggio detection - 创建所有音轨的节奏组
    notesByTrackAll.forEach((trackNotes, trackName) => {
        const { melodicNotes: _unused, rhythmicGroups } = identifyRhythmicGroups(trackNotes);
        rhythmicGroups.forEach(groupNotes => {
            const times = groupNotes.map(n => n.time_start_sec);
            const pitches = groupNotes.map(n => n.pitch);
            const groupTime = d3.mean(times);
            const minPitch = d3.min(pitches);
            const maxPitch = d3.max(pitches);
            const velocitySum = d3.sum(groupNotes.map(n => n.velocity || 0));
            allRhythmicGroups.push({ trackName, time: groupTime, minPitch, maxPitch, notes: groupNotes, velocitySum });
        });
    });

    // === 琶音检测逻辑 (提前定义 connectedSet) ===
    // 1.1) Detect connected arpeggio sequences per track
    const arpeggioSequences = []; // each { trackName, seq: [groupObjs...] }
    const GROUP_TIME_GAP_THRESHOLD = Math.max(beatDurationSec, barDurationSec / 2); // threshold for 'consecutive'

    const groupsByTrack = d3.group(allRhythmicGroups, d => d.trackName);
    groupsByTrack.forEach((groups, trackName) => {
        groups.sort((a, b) => a.time - b.time);
        let seq = [groups[0]];
        for (let i = 1; i < groups.length; i++) {
            const prev = groups[i - 1];
            const cur = groups[i];
            const timeGap = cur.time - prev.time;
            const meanPrev = d3.mean(prev.notes.map(n => n.pitch));
            const meanCur = d3.mean(cur.notes.map(n => n.pitch));

            // Require both temporal proximity and pitch change to connect
            if (timeGap <= GROUP_TIME_GAP_THRESHOLD && Math.abs(meanCur - meanPrev) >= 0.5) {
                seq.push(cur);
            } else {
                if (seq.length >= 2) arpeggioSequences.push({ trackName, seq: seq.slice() });
                seq = [cur];
            }
        }
        if (seq.length >= 2) arpeggioSequences.push({ trackName, seq: seq.slice() });
    });

    // Mark connected groups so we can hide their vertical lines/highlight rects
    const connectedSet = new Set();
    arpeggioSequences.forEach(s => s.seq.forEach(g => connectedSet.add(`${g.trackName}-${g.time}`)));
    // ====================================

    // --- START: MODIFIED VOICE SEGMENTATION AND LINE GENERATION ---
    const voiceNoteSet = new Set(); // Tracks notes used in multi-note voices
    const rhythmicNoteSet = new Set(); // Tracks notes used in rhythmic groups

    allRhythmicGroups.forEach(g => g.notes.forEach(n => rhythmicNoteSet.add(n)));

    const MAX_VOICE_GAP_SEC = 0.8; 
    const MAX_PITCH_DIFF_FOR_VOICE = 12; 
    const MAX_ALLOWED_OVERLAP_SEC = 0.1; 
    const LONG_NOTE_DURATION_THRESHOLD = 0.43; // 孤立长音阈值：0.43 秒

    // 2) Melodic voice separation and Line Generation (Multi-note voices)
    notesByTrack.forEach((trackNotes, trackName) => {
        const { melodicNotes, rhythmicGroups: _rg } = identifyRhythmicGroups(trackNotes);
        const voicesForTrack = splitIntoVoices(melodicNotes, MAX_VOICE_GAP_SEC, MAX_PITCH_DIFF_FOR_VOICE, MAX_ALLOWED_OVERLAP_SEC);
        
        voicesForTrack.forEach((voiceNotes, voiceIndex) => {
            const segments = [];
            
            // Only proceed if it's a multi-note voice
            if (voiceNotes.length > 1) {
                // Mark notes as participating in a voice to exclude them from the isolated long note check
                voiceNotes.forEach(n => voiceNoteSet.add(n)); 

                for (let i = 0; i < voiceNotes.length; i++) {
                    const currentNote = voiceNotes[i];
                    
                    const currentNoteMidTime = currentNote.time_start_sec + currentNote.duration_sec / 2;
                    const currentNoteEndTime = currentNote.time_end_sec;

                    if (i === 0) {
                         const nextNote = voiceNotes[i + 1];
                         const nextNoteMidTime = nextNote.time_start_sec + nextNote.duration_sec / 2;
                         
                         segments.push({
                             x1: xScale(currentNote.time_start_sec),
                             y1: yScale(currentNote.pitch),
                             x2: xScale(nextNoteMidTime),
                             y2: yScale(nextNote.pitch),
                             timeStart: currentNote.time_start_sec,
                             timeEnd: nextNoteMidTime,
                             velocity: currentNote.velocity,
                         });
                         
                    } else {
                         const prevNote = voiceNotes[i - 1];
                         const prevNoteMidTime = prevNote.time_start_sec + prevNote.duration_sec / 2;
                         
                         let x2, y2, timeEnd;
                         
                         if (i === voiceNotes.length - 1) {
                             x2 = xScale(currentNoteEndTime);
                             y2 = yScale(currentNote.pitch);
                             timeEnd = currentNoteEndTime;
                         } else {
                             x2 = xScale(currentNoteMidTime);
                             y2 = yScale(currentNote.pitch);
                             timeEnd = currentNoteMidTime;
                         }

                         segments.push({
                             x1: xScale(prevNoteMidTime),
                             y1: yScale(prevNote.pitch),
                             x2: x2,
                             y2: y2,
                             timeStart: prevNoteMidTime,
                             timeEnd: timeEnd,
                             velocity: currentNote.velocity,
                         });
                    } 
                }

                const avgVelocity = d3.mean(voiceNotes.map(n => n.velocity || 0)) || 0;
                allVoiceSegments.push({ 
                    trackName: trackName, 
                    voiceId: `${trackName}-${voiceIndex}`, 
                    segments: segments, 
                    avgVelocity
                });
            }
        });
    });

    // 3) 孤立长音 Line Generation (start -> end) - 单音
    NON_PERCUSSION_NOTES.forEach(n => {
        // 检查是否：未参与多音符声部连线 AND 未参与节奏组 AND 持续时间超过阈值
        if (!voiceNoteSet.has(n) && !rhythmicNoteSet.has(n)) {
            if ((n.duration_sec || 0) >= LONG_NOTE_DURATION_THRESHOLD) {
                // 孤立长音：[duration起点] -> [duration终点]
                allVoiceSegments.push({
                    trackName: n.track_new,
                    voiceId: `${n.track_new}-long-${n.time_start_sec}-${n.pitch}`, // Unique ID
                    segments: [{
                        x1: xScale(n.time_start_sec),
                        y1: yScale(n.pitch),
                        x2: xScale(n.time_end_sec),
                        y2: yScale(n.pitch),
                        timeStart: n.time_start_sec,
                        timeEnd: n.time_end_sec,
                        velocity: n.velocity || 0,
                    }],
                    avgVelocity: n.velocity || 0 
                });
            }
        }
    });

    // =========================================================================
    // 4) 孤立长音 Rhythmic Group Line Generation (用于 Arpeggio Melody Mode)
    //    新逻辑：仅对组内 duration 超过阈值的单音符绘制长线。
    // =========================================================================
    allRhythmicGroups.forEach(g => {
        const tnl = g.trackName.toLowerCase();
        
        // 1. 排除打击乐音轨
        if (isPercussionTrack(g.trackName)) {
            return;
        }
        // 2. 排除已连接成琶音序列的组 (连接的琶音序列由步骤 3 的 arpeggio-line 处理)
        if (connectedSet.has(`${g.trackName}-${g.time}`)) {
            return;
        }

        // 3. 遍历组内每个音符，并检查其持续时间
        g.notes.forEach((n, noteIndex) => {
            // 检查该音符是否为长音（duration 超过阈值）
            if ((n.duration_sec || 0) >= LONG_NOTE_DURATION_THRESHOLD) {
                
                // 绘制单个音符的孤立长琶音线 (从开始时间到结束时间)
                allVoiceSegments.push({
                    trackName: n.track_new,
                    // 使用唯一的 ID，防止与其他 segments 冲突
                    voiceId: `${n.track_new}-arp-long-note-${n.time_start_sec}-${n.pitch}-${noteIndex}`, 
                    segments: [{
                        x1: xScale(n.time_start_sec),
                        y1: yScale(n.pitch),
                        x2: xScale(n.time_end_sec),
                        y2: yScale(n.pitch), // 保持音高不变
                        timeStart: n.time_start_sec,
                        timeEnd: n.time_end_sec,
                        velocity: n.velocity || 0,
                    }],
                    avgVelocity: n.velocity || 0, 
                    isIsolatedArpGroup: true // <--- 关键标记：用于 D3 绑定时添加 class
                });
            }
        });
    });
    // =========================================================================

    // 5) D3 绑定：使用新的 segment 数据结构和自定义路径生成器
    
    // Custom path generator that handles the segment array structure (x1, y1, x2, y2)
    const segmentPathGenerator = d => {
        const path = d3.path();
        (d.segments || []).forEach((seg, i) => {
            // Move to the start point of the first segment
            if (i === 0) {
                path.moveTo(seg.x1, seg.y1);
            }
            // All segments connect to their end point
            path.lineTo(seg.x2, seg.y2);
        });
        return path.toString();
    };
    
    chartGroup.selectAll(".track-line")
        .data(allVoiceSegments, d => d.voiceId) // Bind data by unique voice ID
        .join("path")
        // === 关键修改：根据标记添加不同的 class ===
        .attr("class", d => "track-line" + (d.isIsolatedArpGroup ? " arp-long-group-line" : ""))
        // ======================================
        .attr("fill", "none")
        .attr("stroke", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 1.0))
        .attr("d", segmentPathGenerator);
        
    // Create highlight points for each track line (initially hidden)
    chartGroup.selectAll(".line-highlight-point")
        .data(allVoiceSegments, d => d.voiceId) // Bind data by unique voice ID
        .join("circle")
        // === 关键修改：圆球也添加对应的 class (.arp-long-group-line-highlight) ===
        .attr("class", d => "line-highlight-point" + (d.isIsolatedArpGroup ? " arp-long-group-line-highlight" : ""))
        // ======================================
        .attr("r", 6)
        .attr("fill", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 2.5))
        .style("opacity", 0)
        .style("filter", "url(#glow)");
    
    // Enable pointer events on track lines and show instrument name tooltip when paused
    chartGroup.selectAll('.track-line')
        .style('pointer-events', 'stroke')
        .on('mouseenter', function(event, d) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            tt.style('display', 'block').text(d.trackName || 'Unknown');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mouseleave', function() {
            d3.select('#line-tooltip').style('display', 'none');
        });

    // --- END: MODIFIED VOICE SEGMENTATION AND LINE GENERATION ---

    // --- 2) Draw rhythmic vertical lines & highlight rects, but hide those that are part of arpeggio sequences ---
    // 【Lines Mode Display - 排除打击乐】: 过滤节奏线和高亮矩形的数据源，排除打击乐音轨。
    const nonPercussionRhythmicGroups = allRhythmicGroups.filter(d => !isPercussionTrack(d.trackName));

    chartGroup.selectAll(".rhythmic-line")
        .data(nonPercussionRhythmicGroups, d => `${d.trackName}-${d.time}`)
        .join("line")
        .attr("class", "rhythmic-line")
        .attr("x1", d => xScale(d.time))
        .attr("x2", d => xScale(d.time))
        .attr("y1", d => yScale(d.maxPitch) + rectHeight / 2)
        .attr("y2", d => yScale(d.minPitch) - rectHeight / 2)
        .attr("stroke", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 1.5))
        .attr("stroke-width", 2)
        .style("opacity", 0.6)
        .style("display", d => connectedSet.has(`${d.trackName}-${d.time}`) ? "none" : "inline");

    chartGroup.selectAll(".rhythmic-highlight-circle")
        .data(nonPercussionRhythmicGroups, d => `${d.trackName}-${d.time}`)
        .join("circle")
        .attr("class", "rhythmic-highlight-circle")
        .attr("cx", d => xScale(d.time))
        .attr("cy", d => {
            const yTop = yScale(d.maxPitch);
            const yBottom = yScale(d.minPitch);
            return (yTop + yBottom) / 2;
        })
        .attr("r", 6)
        .attr("fill", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 2.5))
        .style("opacity", 0)
        .style("display", d => connectedSet.has(`${d.trackName}-${d.time}`) ? "none" : "inline")
        .style("filter", "url(#glow)");

    // --- 3) Render arpeggio-melody lines for each connected sequence (top and bottom)
    const arpeggioPathsData = [];
    arpeggioSequences.forEach(s => {
        const tnl = s.trackName.toLowerCase();
        // 【Lines Mode Display - 排除打击乐】: 过滤 Arpeggio 连线数据源，排除打击乐音轨。
        if (isPercussionTrack(s.trackName)) {
            return;
        }

        const topPoints = s.seq.map(g => ({ x: xScale(g.time), y: yScale(g.maxPitch), time: g.time }));
        const bottomPoints = s.seq.map(g => ({ x: xScale(g.time), y: yScale(g.minPitch), time: g.time }));
        // compute average velocity across all notes that participate in this arpeggio sequence
        const allNotes = s.seq.flatMap(g => (g.notes || []).map(n => n));
        const avgVelocity = d3.mean(allNotes, n => n.velocity || 0) || 0;
        arpeggioPathsData.push({ trackName: s.trackName, type: 'top', points: topPoints, avgVelocity });
        arpeggioPathsData.push({ trackName: s.trackName, type: 'bottom', points: bottomPoints, avgVelocity });
    });

    const arpLineGen = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveMonotoneX);

    chartGroup.selectAll(".arpeggio-line")
        .data(arpeggioPathsData, (d, i) => `${d.trackName}-${d.type}-${i}`)
        .join("path")
        .attr("class", d => `arpeggio-line arpeggio-line-${d.type}`)
        .attr("fill", "none")
        .attr("stroke", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 1.2))
        .attr("stroke-width", d => d.type === 'top' ? 2.5 : 1.8)
        .attr("d", d => arpLineGen(d.points))
        .style("display", "none"); // default hidden, toggled by applyDisplayMode

    // Add highlight points for arpeggio lines (one per arpeggio path)
    chartGroup.selectAll(".arpeggio-highlight-point")
        .data(arpeggioPathsData, (d, i) => `${d.trackName}-${d.type}-${i}`)
        .join("circle")
        .attr("class", "arpeggio-highlight-point")
        .attr("r", 6)
        .attr("fill", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 2.5))
        .style("opacity", 0)
        .style("display", "none")
        .style("filter", "url(#glow)");

    // Create a single arpeggio hit rect per connected rhythmic group in a sequence
    const arpeggioPointHits = [];
    arpeggioSequences.forEach((s, sIdx) => {
        if (isPercussionTrack(s.trackName)) return; // skip percussion sequences entirely
        (s.seq || []).forEach((g, gi) => {
            const cx = xScale(g.time);
            const yTop = yScale(g.maxPitch);
            const yBottom = yScale(g.minPitch);
            const cy = (yTop + yBottom) / 2;
            arpeggioPointHits.push({ trackName: s.trackName, time: g.time, x: cx, y: cy, id: `${s.trackName}-arp-${sIdx}-${gi}` });
        });
    });

    // Also include any rhythmic group (even if not part of a multi-group sequence)
    allRhythmicGroups.forEach((g, gi) => {
        if (isPercussionTrack(g.trackName)) return; // skip percussion groups
        // avoid duplicating entries already added from sequences (match by track and time)
        const exists = arpeggioPointHits.some(p => p.trackName === g.trackName && Math.abs(p.time - g.time) < 1e-6);
        if (!exists) {
            const cx = xScale(g.time);
            const yTop = yScale(g.maxPitch);
            const yBottom = yScale(g.minPitch);
            const cy = (yTop + yBottom) / 2;
            arpeggioPointHits.push({ trackName: g.trackName, time: g.time, x: cx, y: cy, id: `${g.trackName}-arp-all-${gi}` });
        }
    });

    chartGroup.selectAll('.arpeggio-hit-circle')
        .data(arpeggioPointHits, d => d.id)
        .join('circle')
        .attr('class', 'arpeggio-hit-circle')
        .attr('cx', d => xScale(d.time))
        .attr('cy', d => d.y)
        .attr('r', 6)
        .attr('fill', d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 2.5))
        .style('opacity', 0)
        .style('display', 'none')
        .style('filter', 'url(#glow)')
        .style('pointer-events', 'all')
        .on('mouseenter', function(event, d) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            tt.style('display', 'block').text(d.trackName || 'Unknown');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mousemove', function(event) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mouseleave', function() { d3.select('#line-tooltip').style('display', 'none'); });


    // --- 4) Beat markers for single-note per-instrument events ---
    // Identify rhythmic note membership to avoid duplicating markers for rhythmic groups
    const rhythmicNotesSet = new Set();
    allRhythmicGroups.forEach(g => g.notes.forEach(n => rhythmicNotesSet.add(n)));
    const TIME_TOL = (CONFIG.RHYTHMIC_TIME_TOLERANCE_FOR_GROUP !== undefined) ? CONFIG.RHYTHMIC_TIME_TOLERANCE_FOR_GROUP : 0.05;
    const ISOLATED_WINDOW = (CONFIG.RHYTHMIC_ISOLATED_WINDOW !== undefined) ? CONFIG.RHYTHMIC_ISOLATED_WINDOW : TIME_TOL;
    const ISOLATED_EXTENDED_WINDOW = ISOLATED_WINDOW * 1.25; 

    const beatMarkers = [];
    notesByTrackAll.forEach((trackNotes, trackName) => { 
        if (isPercussionTrack(trackName)) return; // percussion handled by dedicated markers
        trackNotes.forEach(n => {
            if (rhythmicNotesSet.has(n)) return; // skip notes that are part of rhythmic groups
            // Count other notes that start near this note within ISOLATED_WINDOW (strict)
            const neighbors = trackNotes.filter(o => Math.abs(o.time_start_sec - n.time_start_sec) < ISOLATED_WINDOW);
            if (neighbors.length === 1) {
                beatMarkers.push({ trackName, time: n.time_start_sec, pitch: n.pitch, note: n });
                return;
            }

            // Additional heuristic: short transient
            const laterNeighbors = trackNotes.filter(o => o.time_start_sec > n.time_start_sec && (o.time_start_sec - n.time_start_sec) < ISOLATED_EXTENDED_WINDOW);
            if (laterNeighbors.length > 0) {
                const next = laterNeighbors.reduce((a,b)=> a.time_start_sec < b.time_start_sec ? a : b);
                if ((n.duration_sec || 0) < (next.duration_sec || Infinity) * 0.45) {
                    // treat n as an isolated short beat
                    beatMarkers.push({ trackName, time: n.time_start_sec, pitch: n.pitch, note: n });
                }
            }
        });
    });

    // Draw short vertical markers for beats (hidden by default; shown in Rhythmic Framework)
    chartGroup.selectAll('.beat-marker')
        .data(beatMarkers, d => `${d.trackName}-${d.time}-${d.pitch}`)
        .join('line')
        .attr('class', 'beat-marker')
        .attr('x1', d => xScale(d.time))
        .attr('x2', d => xScale(d.time))
        .attr('y1', d => yScale(d.pitch) - rectHeight * 0.25)
        .attr('y2', d => yScale(d.pitch) + rectHeight * 0.25)
        .attr('stroke', d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 1.5))
        .attr('stroke-width', 2)
        .style('opacity', 0.9)
        .style('display', 'none');

    // Add small circle hit indicators that appear when the beat is played (visible in Rhythmic Framework on hit)
    chartGroup.selectAll('.beat-hit-circle')
        .data(beatMarkers, d => `${d.trackName}-${d.time}-${d.pitch}`)
        .join('circle')
        .attr('class', 'beat-hit-circle')
        .attr('cx', d => xScale(d.time))
        .attr('cy', d => yScale(d.pitch))
        .attr('r', 6)
        .attr('fill', d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 2.5))
        .style('opacity', 0)
        .style('display', 'none')
        .style('filter', 'url(#glow)');

    // Tooltip for beat markers and hit circles when paused
    chartGroup.selectAll('.beat-marker, .beat-hit-circle')
        .style('pointer-events', 'all')
        .on('mouseenter', function(event, d) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const name = d && (d.trackName || (d.note && d.note.track_new)) || 'Unknown';
            tt.style('display', 'block').text(name);
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mousemove', function(event) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mouseleave', function() {
            d3.select('#line-tooltip').style('display', 'none');
        });

    // --- 5) Percussion kit notes: white vertical markers for Beat and Line modes ---
    // Filter percussion kit notes
    const percussionNotes = notes.filter(d => isPercussionTrack(d.track_new));

    // Draw white vertical markers for percussion notes (similar to beat-marker, but white)
    // Opacity encodes velocity
    chartGroup.selectAll('.percussion-marker')
        .data(percussionNotes, d => `${d.track_new}-${d.time_start_sec}-${d.pitch}`)
        .join('line')
        .attr('class', 'percussion-marker')
        .attr('x1', d => xScale(d.time_start_sec))
        .attr('x2', d => xScale(d.time_start_sec))
        .attr('y1', d => yScale(d.pitch) - rectHeight * 0.25)
        .attr('y2', d => yScale(d.pitch) + rectHeight * 0.25)
        .attr('stroke', 'white')
        .attr('stroke-width', 2)
        .style('opacity', d => 0.4 + (d.velocity || 0) / 127 * 0.5) // Opacity encodes velocity
        .style('display', 'none'); // Hidden by default, shown in Beat/Line modes

    // Draw white flashing squares for percussion notes when playhead hits them
    // Size and opacity encode velocity
    chartGroup.selectAll('.percussion-hit-rect')
        .data(percussionNotes, d => `${d.track_new}-${d.time_start_sec}-${d.pitch}`)
        .join('rect')
        .attr('class', 'percussion-hit-rect')
        .attr('x', d => {
            const baseSize = 6;
            const velocitySize = ((d.velocity || 0) / 127) * 6; // Size based on velocity (6-12)
            return xScale(d.time_start_sec) - (baseSize + velocitySize);
        })
        .attr('y', d => {
            const baseSize = 6;
            const velocitySize = ((d.velocity || 0) / 127) * 6;
            return yScale(d.pitch) - (baseSize + velocitySize);
        })
        .attr('width', d => {
            const baseSize = 6;
            const velocitySize = ((d.velocity || 0) / 127) * 6;
            return (baseSize + velocitySize) * 2;
        })
        .attr('height', d => {
            const baseSize = 6;
            const velocitySize = ((d.velocity || 0) / 127) * 6;
            return (baseSize + velocitySize) * 2;
        })
        .attr('fill', 'white')
        .style('opacity', 0)
        .style('display', 'none') // Hidden by default, shown in Beat/Line/Arpeggio modes
        .attr('data-velocity', d => d.velocity || 0) // Store velocity for dynamic opacity
        .style('rx', 2)
        .style('ry', 2);

    // Enable tooltip on hover for rhythmic and arpeggio elements when paused
    chartGroup.selectAll('.rhythmic-line, .rhythmic-highlight-circle, .arpeggio-line, .arpeggio-highlight-point')
        .style('pointer-events', 'all')
        .on('mouseenter', function(event, d) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const name = d && (d.trackName || (d.notes && d.notes[0] && d.notes[0].track_new)) || 'Unknown';
            tt.style('display', 'block').text(name);
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mousemove', function(event) {
            if (Tone.Transport.state !== 'paused') return;
            const tt = d3.select('#line-tooltip');
            const pageX = event.pageX || (event.clientX + window.scrollX);
            const pageY = event.pageY || (event.clientY + window.scrollY);
            tt.style('left', (pageX + 10) + 'px').style('top', (pageY + 10) + 'px');
        })
        .on('mouseleave', function() {
            d3.select('#line-tooltip').style('display', 'none');
        });

    rebuildLineAnchors();
    
    // 应用节奏轮和小节线的显示状态
    if (typeof updateRhythmWheelVisibility === 'function') {
        updateRhythmWheelVisibility();
    }
}


function toggleDisplayMode() {
    displayMode = (displayMode + 1) % CONFIG.DISPLAY_MODE_NAMES.length;
    toggleDisplayModeButton.text(`Mode: ${CONFIG.DISPLAY_MODE_NAMES[displayMode]}`);
    applyDisplayMode();
}

function updatePercussionButtonLabel() {
    if (!togglePercussionButton || togglePercussionButton.empty()) return;
    togglePercussionButton.text(showPercussion ? "Percussion: On" : "Percussion: Off");
}

function toggleRhythmWheel() {
    showRhythmWheel = !showRhythmWheel;
    updateRhythmWheelVisibility();
}

function updateRhythmWheelVisibility() {
    // 控制节奏轮容器的显示/隐藏
    const rhythmVizContainer = d3.select("#rhythm-viz");
    if (rhythmVizContainer.node()) {
        rhythmVizContainer.style("display", showRhythmWheel ? "flex" : "none");
    }
    
    // 控制小节线和节拍线的显示/隐藏
    if (chartGroup) {
        chartGroup.selectAll(".bar-line").style("display", showRhythmWheel ? "inline" : "none");
        chartGroup.selectAll(".beat-line").style("display", showRhythmWheel ? "inline" : "none");
    }
    
    // 控制小节数字标注的显示/隐藏
    if (barLabelGroup) {
        barLabelGroup.selectAll(".bar-label").style("display", showRhythmWheel ? "inline" : "none");
    }
    
    // 更新按钮文本
    if (toggleRhythmWheelButton && !toggleRhythmWheelButton.empty()) {
        toggleRhythmWheelButton.text(showRhythmWheel ? "Hide" : "Show");
    }
}

function applyDisplayMode() {
    const lines = chartGroup.selectAll(".track-line:not(.arp-long-group-line)"); 
    const notes = chartGroup.selectAll(".note");
    const rhythmicLines = chartGroup.selectAll(".rhythmic-line, .rhythmic-highlight-circle");
    const arpeggioLines = chartGroup.selectAll(".arpeggio-line");
    const arpeggioHighlights = chartGroup.selectAll(".arpeggio-highlight-point");
    const arpeggioHits = chartGroup.selectAll('.arpeggio-hit-circle');
    const arpMelodyLines = chartGroup.selectAll('.arp-melody-line');
    const beatMarkers = chartGroup.selectAll('.beat-marker');
    const beatHits = chartGroup.selectAll('.beat-hit-circle');
    const isolatedArpLines = chartGroup.selectAll('.arp-long-group-line');
    const isolatedArpHighlights = chartGroup.selectAll('.arp-long-group-line-highlight');
    const lineHighlights = chartGroup.selectAll('.line-highlight-point');


    const showNotes = displayMode === 0;
    const showRhythmicFramework = displayMode === 1;
    const showMonoMelody = displayMode === 2;
    const showExpandedMelody = displayMode === 3;
    const showRhythmicMelody = displayMode === 4;

    lines.style("display", (showMonoMelody || showExpandedMelody || showRhythmicMelody) ? "inline" : "none");
    rhythmicLines.style("display", (showRhythmicFramework || showRhythmicMelody || showMonoMelody) ? "inline" : "none");    arpeggioLines.style("display", (showExpandedMelody || showRhythmicMelody) ? "inline" : "none");
    arpMelodyLines.style('display', (showExpandedMelody || showRhythmicMelody) ? 'inline' : 'none');
    chartGroup.selectAll('.arp-melody-highlight-point').style('display', showExpandedMelody ? 'inline' : 'none');
    // Arpeggio highlight points仅在 Expanded Melody 中展示；Monophonic 不展示
    arpeggioHighlights.style("display", showExpandedMelody ? "inline" : "none");
    lineHighlights.style('display', (showMonoMelody || showExpandedMelody) ? 'inline' : 'none');
    beatMarkers.style('display', showRhythmicFramework ? 'inline' : 'none');
    beatHits.style('display', (showRhythmicFramework || showRhythmicMelody) ? 'inline' : 'none');
    arpeggioHits.style('display', (showRhythmicFramework || showMonoMelody || showRhythmicMelody) ? 'inline' : 'none');
    const percussionMarkers = chartGroup.selectAll('.percussion-marker');
    const percussionHits = chartGroup.selectAll('.percussion-hit-rect');
    percussionMarkers.style('display',
        (showPercussion && (showRhythmicFramework || showMonoMelody || showExpandedMelody || showRhythmicMelody))
            ? 'inline' : 'none');
    percussionHits.style('display',
        (showPercussion && (showRhythmicFramework || showMonoMelody || showExpandedMelody || showRhythmicMelody))
            ? 'inline' : 'none');
    notes.style("display", d => {
        if (!showNotes) return "none";
        const isPerc = isPercussionTrack(d.track_new || d.trackName);
        return (showPercussion || !isPerc) ? "inline" : "none";
    });
    
    if (showExpandedMelody || showRhythmicMelody) {
        isolatedArpLines.style('display', 'inline');
        isolatedArpHighlights.style('display', showExpandedMelody ? 'inline' : 'none');
    } else {
        isolatedArpLines.style('display', 'none');
        isolatedArpHighlights.style('display', 'none');
    }
    
    updateVizD(Tone.Transport.state === 'stopped', false);
}

function updateRhythmWheel() {
    if (!beatPoints || beatDurationSec <= 0 || beatNumerator <= 0) return;

    const currentSeconds = Tone.Transport.seconds;
    const timeInBar = currentSeconds % barDurationSec;
    const currentBeatIndex = Math.floor(timeInBar / beatDurationSec) % beatNumerator;

    const barStart = Math.floor(currentSeconds / barDurationSec) * barDurationSec;
    const barEnd = barStart + barDurationSec;
    const percussionBeatSet = new Set();
    if (Array.isArray(viewDNotes)) {
        viewDNotes.forEach(n => {
            const tn = (n.track_new || '').toLowerCase();
            if (!isPercussionTrack(n.track_new)) return;
            if (n.time_start_sec >= barStart && n.time_start_sec < barEnd) {
                const idx = Math.floor((n.time_start_sec - barStart) / beatDurationSec);
                if (idx >= 0 && idx < beatNumerator) percussionBeatSet.add(idx);
            }
        });
    }

    beatPoints.each(function(d, i) {
        const isCurrentBeat = i === currentBeatIndex;
        d3.select(this).classed("highlight", isCurrentBeat);
    });
    
    if (rhythmPercussionOverlays) {
        rhythmPercussionOverlays.each(function(d, i) {
            const overlay = d3.select(this);
            const isPerc = percussionBeatSet.has(i);
            overlay.style("display", isPerc ? "inline" : "none");
            overlay.classed("active-percussion-overlay", isPerc);
        });
    }
}

function updateScrollbarValue() {
    if (!xScrollbar || TRANSLATION_PIXEL_RANGE <= 0) return;
    const normalizedValue = (maxTranslationX - currentTranslationX) / TRANSLATION_PIXEL_RANGE;
    xScrollbar.value = normalizedValue * CONFIG.SCROLLBAR_RANGE;
}

function handleScrollbarInput(event) {
    if (Tone.Transport.state === 'started') {
        togglePlaybackCallback();
    }

    const normalizedValue = parseFloat(event.target.value) / CONFIG.SCROLLBAR_RANGE;

    currentTranslationX = maxTranslationX - normalizedValue * TRANSLATION_PIXEL_RANGE;
    
    currentTime = xScale.invert(playheadX - currentTranslationX);
    Tone.Transport.seconds = currentTime;
    
    updateVizD(false, true);

    window.dispatchEvent(new CustomEvent('timejump', { detail: { time: currentTime } }));
}

function setupAutoStopD() {
    if (transportScheduleId !== null) { Tone.Transport.clear(transportScheduleId); }
    const stopTime = originalMaxTime + CONFIG.END_DELAY_SECONDS;
    transportScheduleId = Tone.Transport.scheduleOnce(() => {
        Tone.Transport.stop(); 
    }, stopTime);
}

function togglePlayback() {
    if (!allAssetsLoaded) return;
    togglePlaybackCallback();
}


function animate() {
    if (Tone.Transport.state !== 'started') {
        clearTimeout(vizUpdateLoop);
        vizUpdateLoop = null;
        return;
    }

    // This is the core animation loop
    updateVizD(false, false);

    vizUpdateLoop = setTimeout(animate, CONFIG.FRAME_RATE);
}

function updateVizD(isStopping = false, skipGlowUpdates = false) { 
    const TOLERANCE = 0.05;
    if (!xScale || !xAxisGroup) return;

    // --- Update time and position ---
    if (isStopping) {
        currentTime = 0;
        currentTranslationX = maxTranslationX;
        updateScrollbarValue();
        clearTimeout(vizUpdateLoop);
        vizUpdateLoop = null;
    } else if (Tone.Transport.state === 'started' && !skipGlowUpdates) {
        currentTime = Tone.Transport.seconds;
        currentTranslationX = playheadX - xScale(currentTime);
        updateScrollbarValue(); 
    } else {
        currentTime = Tone.Transport.seconds;
    }
    
    chartGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    xAxisGroup.attr("transform", `translate(${currentTranslationX}, ${CONFIG.DRAWING_HEIGHT})`);
    barLabelGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    d3.select(timeLabel.node()).text(`${currentTime.toFixed(2)}s`);

    const notes = chartGroup.selectAll(".note");
    const highlightPoints = chartGroup.selectAll(".line-highlight-point, .arp-long-group-line-highlight"); 

    const isRhythmicFramework = displayMode === 1;
    const isMonophonicMelody = displayMode === 2;
    const isExpandedMelody = displayMode === 3;
    const isRhythmicMelody = displayMode === 4;

    if (lineAnchorsDirty) rebuildLineAnchors();
    const pitchFromY = y => yScale ? yScale.invert(y) : y;
    const isPointCoveredByLine = (trackName, time, pitch) => {
        if (!trackName || !isFinite(time) || !isFinite(pitch)) return false;
        const anchors = lineAnchorByTrack.get(trackName);
        if (!anchors) return false;
        for (let i = 0; i < anchors.length; i++) {
            const a = anchors[i];
            if (Math.abs(a.time - time) <= TOLERANCE && Math.abs(a.pitch - pitch) <= 0.75) {
                return true;
            }
        }
        return false;
    };

    notes.classed("glow", false);
    chartGroup.selectAll(".line-highlight-point, .arpeggio-highlight-point, .arp-melody-highlight-point, .arp-long-group-line-highlight")
        .style("opacity", 0);


    const pianoActive = new Set();
    const arpCirclesActive = new Set();
    const lineArpSquareUnion = new Set();

    const arpHighlightData = chartGroup.selectAll('.arpeggio-highlight-point').data() || [];
    arpHighlightData.forEach(d => {
        if (!d || !d.points || d.points.length < 2) return;
        const firstTime = d.points[0].time;
        const lastTime = d.points[d.points.length - 1].time;
        if (currentTime >= firstTime && currentTime <= lastTime + TOLERANCE) { 
            if (d.trackName) {
                arpCirclesActive.add(d.trackName);
                lineArpSquareUnion.add(d.trackName);
            }
        }
    });

    const lineHighlightData = chartGroup.selectAll('.line-highlight-point, .arp-long-group-line-highlight').data() || [];
    lineHighlightData.forEach(d => {
        if (!d || !d.segments) return;
        const segments = d.segments;
        for (let i = 0; i < segments.length - 1; i++) {
            const note1 = segments[i];
            const note2 = segments[i + 1];
            if (note1 && note2 && currentTime >= note1.time_start_sec && currentTime <= note2.time_start_sec + TOLERANCE) { 
                if (d.trackName) lineArpSquareUnion.add(d.trackName);
                break;
            }
        }
    });

    const RHYTHM_HIT_TOLERANCE = (CONFIG.RHYTHMIC_HIT_TOLERANCE !== undefined) ? CONFIG.RHYTHMIC_HIT_TOLERANCE : 0.08;
    const rhythmicGroupsData = chartGroup.selectAll('.rhythmic-highlight-circle').data() || [];
    rhythmicGroupsData.forEach(d => {
        if (!d) return;
        if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
            if (d.trackName) lineArpSquareUnion.add(d.trackName);
        }
    });

    const beatHitData = chartGroup.selectAll('.beat-hit-circle').data() || [];
    beatHitData.forEach(d => {
        if (!d) return;
        if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
            if (d.trackName) lineArpSquareUnion.add(d.trackName);
        }
    });
    const arpeggioHitData = chartGroup.selectAll('.arpeggio-hit-circle').data() || [];
    arpeggioHitData.forEach(d => {
        if (!d) return;
        if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
            if (d.trackName) lineArpSquareUnion.add(d.trackName);
        }
    });
    // Percussion markers/hits should also activate legend (only when percussion is shown)
    if (showPercussion) {
        const percussionMarkerData = chartGroup.selectAll('.percussion-marker').data() || [];
        percussionMarkerData.forEach(d => {
            if (!d) return;
            if (Math.abs(currentTime - d.time_start_sec) <= RHYTHM_HIT_TOLERANCE) {
                if (d.track_new) {
                    lineArpSquareUnion.add(d.track_new);
                    arpCirclesActive.add(d.track_new); // allow legend activation in Expanded Melody mode
                }
            }
        });
        const percussionHitData = chartGroup.selectAll('.percussion-hit-rect').data() || [];
        percussionHitData.forEach(d => {
            if (!d) return;
            if (Math.abs(currentTime - d.time_start_sec) <= RHYTHM_HIT_TOLERANCE) {
                if (d.track_new) {
                    lineArpSquareUnion.add(d.track_new);
                    arpCirclesActive.add(d.track_new); // allow legend activation in Expanded Melody mode
                }
            }
        });
    }

    let activeTracks;
    if (displayMode === 0) activeTracks = pianoActive;
    else if (displayMode === 3) activeTracks = arpCirclesActive;
    else if (displayMode === 4) activeTracks = lineArpSquareUnion;
    else activeTracks = lineArpSquareUnion;

    if (displayMode === 0) {
        // In Piano Roll mode, encode velocity via `fill-opacity` so glow can temporarily set full fill without
        // losing the velocity mapping once the highlight ends.
        notes.each(function() {
            const noteElement = d3.select(this);
            const baseColor = noteElement.attr("data-track-color");
            const baseFillOpacity = parseFloat(noteElement.attr("data-velocity-fill-opacity")) || 0.6;
            noteElement.attr("fill", baseColor).attr("fill-opacity", baseFillOpacity);
        });
    }

    if (!isStopping && !skipGlowUpdates) {
        if (displayMode === 0) {
            notes.filter(function(d) {
                return d.time_start_sec - TOLERANCE <= currentTime && d.time_end_sec > currentTime - TOLERANCE;
            }).each(function(d) {
                d3.select(this)
                    .classed("glow", true)
                    // Temporarily bring the fill fully opaque for the glow effect; we modify fill-opacity
                    // (not element opacity) so other visual effects/strokes remain independent.
                    .attr("fill-opacity", 1)
                    .attr("fill", function() { return d3.select(this).attr("data-track-color-light"); });
                this.parentNode.appendChild(this);
                const tn = d.track_new || d.trackName || null;
                if (tn) {
                    const isPerc = isPercussionTrack(tn);
                    if (!isPerc || showPercussion) {
                        activeTracks.add(tn);
                    }
                }
            });

        } else if (displayMode === 1 || displayMode === 2 || displayMode === 3 || displayMode === 4) {
            if (isExpandedMelody || isMonophonicMelody) {
                highlightPoints.each(function(d) {
                    const pointElement = d3.select(this);
                    const segments = d.segments; 
                    
                    if (!segments || segments.length === 0) {
                        pointElement.style("opacity", 0);
                        return;
                    }
                    
                    let foundSegment = false;
                    for (let i = 0; i < segments.length; i++) {
                        const seg = segments[i]; 
                        if (currentTime >= seg.timeStart && currentTime <= seg.timeEnd + TOLERANCE) {
                            foundSegment = true;
                            const timeSpan = seg.timeEnd - seg.timeStart;
                            const t = (currentTime - seg.timeStart) / Math.max(1e-6, timeSpan); 
                            const currentX = xScale(currentTime);
                            const currentY = seg.y1 + t * (seg.y2 - seg.y1); 
                            const velocity = seg.velocity || 0;
                            const minRadius = 1;
                            const maxRadius = 15;
                            const VELOCITY_TO_RADIUS_EXPONENT = 0.714;
                            const normalizedVelocity = Math.max(velocity, 1e-6) / 127;
                            const perceivedRatio = Math.pow(normalizedVelocity, VELOCITY_TO_RADIUS_EXPONENT);
                            const radiusRange = maxRadius - minRadius;
                            const dynamicRadius = minRadius + perceivedRatio * radiusRange;

                            pointElement.attr("cx", currentX)
                                .attr("cy", currentY)
                                .attr("r", dynamicRadius)
                                .style("opacity", 1); 

                            if (d.trackName) {
                                if (isExpandedMelody) {
                                    arpCirclesActive.add(d.trackName);
                                } else if (isMonophonicMelody) {
                                    lineArpSquareUnion.add(d.trackName);
                                }
                            }
                            break;
                        }
                    }
                    if (!foundSegment) {
                        pointElement.style("opacity", 0); 
                    }
                });
            }
            // Monophonic Melody / Rhythmic Melody use beat-style flashing circles (handled in beat/arpeggio sections)


            const getPitchForDatum = (d) => {
                if (!d) return null;
                if (typeof d.pitch === 'number') return d.pitch;
                if (typeof d.y === 'number') return pitchFromY(d.y);
                if (typeof d.minPitch === 'number' && typeof d.maxPitch === 'number') {
                    return (d.minPitch + d.maxPitch) / 2;
                }
                return null;
            };

            if (displayMode === 4) {
                const rhythmicCircles = chartGroup.selectAll(".rhythmic-highlight-circle");
                const rhythmicLines = chartGroup.selectAll(".rhythmic-line");
                rhythmicCircles.each(function(d) {
                    const circle = d3.select(this);
                    if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
                        circle.style("opacity", 1);
                    } else {
                        circle.style("opacity", 0);
                    }
                });

                rhythmicLines.each(function(d) {
                    const lineEl = d3.select(this);
                    if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
                        lineEl.style("opacity", 1).attr("stroke-width", 3);
                    } else {
                        lineEl.style("opacity", 0.6).attr("stroke-width", 2);
                    }
                });
            }

            if (isRhythmicFramework || isMonophonicMelody || isRhythmicMelody || isExpandedMelody) {
                if (isRhythmicFramework || isRhythmicMelody) {
                    const beatCircles = chartGroup.selectAll('.beat-hit-circle');
                    beatCircles.each(function(d) {
                        const circle = d3.select(this);
                        if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE) {
                            circle.style('opacity', 1);
                        } else {
                            circle.style('opacity', 0);
                        }
                    });
                }
                const arpCircles = chartGroup.selectAll('.arpeggio-hit-circle');
                arpCircles.each(function(d) {
                    const circle = d3.select(this);
                    const pitch = getPitchForDatum(d);
                    const covered = isMonophonicMelody && isPointCoveredByLine(d.trackName, d.time, pitch);
                    if (Math.abs(currentTime - d.time) <= RHYTHM_HIT_TOLERANCE && !covered) {
                        circle.style('opacity', 1);
                    } else {
                        circle.style('opacity', 0);
                    }
                });
                const percussionRects = chartGroup.selectAll('.percussion-hit-rect');
                percussionRects.each(function(d) {
                    const rect = d3.select(this);
                    const noteTime = d.time_start_sec;
                    const velocity = d.velocity || 0;
                    if (showPercussion && Math.abs(currentTime - noteTime) <= RHYTHM_HIT_TOLERANCE) {
                        rect.style('opacity', 0.5 + (velocity / 127) * 0.5);
                    } else {
                        rect.style('opacity', 0);
                    }
                });
            }

            // Expanded Melody: hide flashing circles，仅保留连续圆球
            if (isExpandedMelody) {
                // Hide all flashing circles in Melody mode
                chartGroup.selectAll('.arpeggio-hit-circle').style('opacity', 0);
                chartGroup.selectAll('.beat-hit-circle').style('opacity', 0);
                chartGroup.selectAll('.rhythmic-highlight-circle').style('opacity', 0);
            }

            // Rhythmic Melody: 只保留激活闪烁（无连续圆球）
            // All Beat mode flashing logic is handled in the Beat mode section above (displayMode === 1 || displayMode === 4)
            // Here we just ensure Melody mode continuous moving circles are hidden
            if (isRhythmicMelody) {
                // Hide all Melody mode continuous moving circles
                chartGroup.selectAll('.arpeggio-highlight-point').style('opacity', 0);
                chartGroup.selectAll('.line-highlight-point').style('opacity', 0);
                chartGroup.selectAll('.arp-melody-highlight-point').style('opacity', 0);
                chartGroup.selectAll('.arp-long-group-line-highlight').style('opacity', 0);
            }

            // Apply track lines opacity for Melody and Test modes
            if (isMonophonicMelody || isExpandedMelody || isRhythmicMelody) {
                const trackLines = chartGroup.selectAll('.track-line');
                const trackData = trackLines.data() || [];
                const maxAvg = d3.max(trackData, d => d.avgVelocity) || 1;

                // Opacity mapping (existing behavior)
                trackLines.style('opacity', d => {
                    const v = (d.avgVelocity || 0);
                    return 0.15 + 0.85 * (v / Math.max(maxAvg, 1e-6));
                });

                // Stroke-width mapping based on avgVelocity
                trackLines.attr('stroke-width', d => {
                    const v = (d.avgVelocity || 0);
                    const norm = (v / Math.max(maxAvg, 1e-6));
                    return TRACK_MIN_STROKE + norm * (TRACK_MAX_STROKE - TRACK_MIN_STROKE);
                });
            }

            // If we're in Melody mode, encode velocity as opacity and move arpeggio highlight points.
            // Test mode should not have continuous moving circles
            if (isExpandedMelody || isMonophonicMelody) {

                // ... (其他样式更新逻辑保持不变) ...

                // 4) Move arpeggio highlight points along their path (仅 Expanded Melody 显示)
                const arpHighlights = chartGroup.selectAll('.arpeggio-highlight-point');
                if (isExpandedMelody) {
                    arpHighlights.each(function(d) {
                        const pt = d3.select(this);
                        if (!d.points || d.points.length < 2) {
                            pt.style('opacity', 0);
                            return;
                        }

                        const points = d.points;
                        const firstTime = points[0].time;
                        const lastTime = points[points.length - 1].time;
                        if (currentTime < firstTime || currentTime > lastTime + TOLERANCE) { 
                            pt.style('opacity', 0);
                            return;
                        }

                        // Find segment that contains currentTime
                        let segIdx = -1;
                        for (let s = 0; s < points.length - 1; s++) {
                            if (currentTime >= points[s].time && currentTime <= points[s+1].time + TOLERANCE) { segIdx = s; break; } 
                        }
                        if (segIdx === -1) { pt.style('opacity', 0); return; }

                        const p1 = points[segIdx];
                        const p2 = points[segIdx+1];
                        const t = (currentTime - p1.time) / Math.max(1e-6, (p2.time - p1.time));
                        const cx = xScale(currentTime);
                        const cy = p1.y + t * (p2.y - p1.y);
                        pt.attr('cx', cx).attr('cy', cy).style('opacity', 1);
                        if (d.trackName) arpCirclesActive.add(d.trackName);
                    });
                } else {
                    arpHighlights.style('opacity', 0);
                }

                // ... (琶音高亮点的样式更新逻辑保持不变) ...

                // Move and style highlight points for long-note segments (arp-melody segments) (略...)
                const arpMelHighlights = chartGroup.selectAll('.arp-melody-highlight-point');
                arpMelHighlights.each(function(d) {
                    const pt = d3.select(this);
                    if (!d) { pt.style('opacity', 0); return; }
                    // if playhead outside segment, hide
                    if (currentTime < d.start || currentTime > d.end + TOLERANCE) { pt.style('opacity', 0); return; } // [FIX 2d]: 使用容忍度

                    const cx = xScale(currentTime);
                    const cy = yScale(d.pitch);

                    // ... (计算半径和透明度逻辑保持不变) ...

                    pt.attr('cx', cx).attr('cy', cy).attr('r', rM).style('opacity', opacityM);

                    if (d.trackName) {
                        if (displayMode === 3) arpCirclesActive.add(d.trackName);
                    }
                });
            }
        }
    }

    // After processing all highlight sources (Piano Roll, Lines, Arpeggio), update legend once to keep modes synchronized
const legendItems = d3.selectAll('#legend .legend-item');
if (activeTracks.size > 0) {
    legendItems.style('opacity', d => {
        // percussion track 单独处理
        const isPercussion = isPercussionTrack(d);
        const isActive = activeTracks.has(d);
        return isActive ? 1 : 0.35;
    })
    .style('filter', d => {
        const isActive = activeTracks.has(d);
        return isActive ? 'none' : 'grayscale(60%)';
    });
} else {
    legendItems.style('opacity', 0.35).style('filter', 'grayscale(60%)');
}
    
    // Start the animation loop if it's not already running
    if (Tone.Transport.state === 'started' && !vizUpdateLoop) {
        // Use setTimeout to break the synchronous call chain and prevent the browser from freezing
        setTimeout(animate, 0);
    }
    
    updateRhythmWheel();
}


const dragHandler = d3.drag()
    .on("start", function(event) {
        if (Tone.Transport.state === 'started') {
            event.on("drag", null).on("end", null);
            togglePlaybackCallback();
        }
    })
    .on("drag", function(event) {
        if (Tone.Transport.state !== 'started') {
            const newX = currentTranslationX + event.dx;

            currentTranslationX = Math.min(maxTranslationX, Math.max(minTranslationX, newX));

            currentTime = xScale.invert(playheadX - currentTranslationX);
            Tone.Transport.seconds = currentTime;
            
            updateScrollbarValue();
            updateVizD(false, true); 
        }
    })
    .on("end", function(event) {
        if (Tone.Transport.state !== 'started') {
            updateVizD(false, false); 
        }
    });


// --- 4. 核心初始化函数 (VIEW D) ---

/**
 * 暴露给 main.js：D 视图的初始化入口。
 */
async function initViewD(containerId, notesData, infoData, maxTime, audioPlayerInstance, callbacks) {
    viewDNotes = notesData; // Store notes data locally
    
    // 获取容器的实时尺寸
    const containerNode = document.getElementById(containerId.replace('#', ''));
    let innerWidth = containerNode.clientWidth - CONFIG.MARGIN.left - CONFIG.MARGIN.right;
    let innerHeight = containerNode.clientHeight - CONFIG.MARGIN.top - CONFIG.MARGIN.bottom;

    // --- 关键 Debug 检查和尺寸修复 ---
    if (containerNode.clientWidth <= 10 || containerNode.clientHeight <= 10) {
        // 尺寸异常，可能是 Flexbox/CSS 尚未计算完成
        console.error(`[View D Debug] 容器 ${containerId} 尺寸异常。clientWidth: ${containerNode.clientWidth}, clientHeight: ${containerNode.clientHeight}. 请检查 index.html 中的 CSS 布局，确保 #view-D-dataviz 具有明确高度/flex-grow。将使用回退尺寸。`);
        
        // 使用一个合理的固定尺寸作为回退，防止 D3 崩溃
        innerWidth = 700 - CONFIG.MARGIN.left - CONFIG.MARGIN.right;
        innerHeight = 300 - CONFIG.MARGIN.top - CONFIG.MARGIN.bottom;
    }
    // ---------------------------------

    CONFIG.DRAWING_WIDTH = innerWidth;
    CONFIG.DRAWING_HEIGHT = innerHeight;
    
    const outerWidth = innerWidth + CONFIG.MARGIN.left + CONFIG.MARGIN.right;
    const outerHeight = innerHeight + CONFIG.MARGIN.top + CONFIG.MARGIN.bottom;

    // 移除旧的 SVG
    d3.select(containerId).select('svg').remove();

    // 创建主 SVG 元素
    svg = d3.select(containerId)
        .append("svg")
        .attr("width", outerWidth)
        .attr("height", outerHeight)
        .attr("class", "draggable-chart")
        .append("g")
        .attr("transform", `translate(${CONFIG.MARGIN.left},${CONFIG.MARGIN.top})`);
        
    playheadX = CONFIG.DRAWING_WIDTH * CONFIG.PLAYHEAD_X_RATIO;
    chartGroup = svg.append("g").attr("class", "chart-group");
    barLabelGroup = svg.append("g").attr("class", "bar-label-group");

    // 创建浮动提示框（全局，仅一次）
    if (d3.select('#line-tooltip').empty()) {
        d3.select('body').append('div')
            .attr('id', 'line-tooltip')
            .style('position', 'absolute')
            .style('pointer-events', 'none')
            .style('padding', '6px 8px')
            .style('background', 'rgba(0,0,0,0.8)')
            .style('color', '#fff')
            .style('font-size', '12px')
            .style('border-radius', '4px')
            .style('box-shadow', '0 2px 6px rgba(0,0,0,0.5)')
            .style('display', 'none');
    }
    
    // 设置回调和音频引用
    togglePlaybackCallback = callbacks.togglePlayback;
    audioPlayer = audioPlayerInstance;

    // --- 音乐配置 ---
    currentBPM = infoData.bpm || 120;
    beatNumerator = infoData.numerator || 4;
    const beatDenominator = infoData.denominator || 4;
    
    Tone.Transport.bpm.value = currentBPM;
    Tone.Transport.timeSignature = [beatNumerator, beatDenominator];

    beatDurationSec = (60 / currentBPM) * (4 / beatDenominator);
    barDurationSec = beatDurationSec * beatNumerator;

    d3.select("#rhythm-info").text(`BPM: ${currentBPM.toFixed(1)} | Time Signature: ${beatNumerator}/${beatDenominator}`);

    // 音轨名称和颜色比例尺
    const trackNames = Array.from(new Set(notesData.map(d => d.track_new)));
    // 创建 colorScale 时排除 percussion
const melodicTrackNames = trackNames.filter(t => !isPercussionTrack(t));
colorScale = d3.scaleOrdinal().domain(melodicTrackNames).range(d3.schemeTableau10);
    drawLegend(trackNames);

    // --- 比例尺定义 ---
    originalMaxTime = maxTime - CONFIG.END_DELAY_SECONDS; 
    
    const FIXED_DETAIL_WINDOW_SEC = 8; 
    const PIXELS_PER_SECOND = CONFIG.DRAWING_WIDTH / FIXED_DETAIL_WINDOW_SEC; 

    fullChartWidth = maxTime * PIXELS_PER_SECOND;

    xScale = d3.scaleLinear()
        .domain([0, maxTime])
        .range([0, fullChartWidth]);

    minTranslationX = playheadX - fullChartWidth;	
    maxTranslationX = playheadX - xScale(0);	

    TRANSLATION_PIXEL_RANGE = maxTranslationX - minTranslationX;
    
    // 确保滚动条事件只绑定一次
    if (!xScrollbar.hasListener) {
        xScrollbar.addEventListener('input', handleScrollbarInput);
        xScrollbar.hasListener = true;
    }
    // --- 比例尺定义 (结束) ---


    // 绘制核心元素
    setupDefs();
    drawPlayhead();
    drawPianoRollElements(notesData);	
    drawRhythmWheel();


    allAssetsLoaded = true;
    statusButton.text("▶ Play (Ready)").on("click", togglePlayback);
    toggleDisplayModeButton.on("click", toggleDisplayMode); // 确保绑定
    if (togglePercussionButton && !togglePercussionButton.empty()) {
        togglePercussionButton.on("click", () => {
            showPercussion = !showPercussion;
            updatePercussionButtonLabel();
            applyDisplayMode();
            updateRhythmWheel();
        });
        updatePercussionButtonLabel();
    }
    if (toggleRhythmWheelButton && !toggleRhythmWheelButton.empty()) {
        toggleRhythmWheelButton.on("click", toggleRhythmWheel);
        updateRhythmWheelVisibility();
    }

    // 初始化位置
    currentTranslationX = maxTranslationX;	
    chartGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    xAxisGroup.attr("transform", `translate(${currentTranslationX}, ${CONFIG.DRAWING_HEIGHT})`);
    barLabelGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    
    updateScrollbarValue();	
    
    // 初始状态运行一次完整的 updateViz
    updateVizD(false, false);
    
    // Apply the initial display mode to hide lines by default
    applyDisplayMode();

    svg.call(dragHandler);
}


// --- 暴露全局接口 (供 main.js 协调器调用) ---

/** @function initViewD - D 视图的初始化函数。 */
window.initViewD = initViewD;

/** @function updateVizD - D 视图的动画/同步更新函数。 */
window.updateVizD = updateVizD;

/** @function setupAutoStopD - 设置播放自动停止的函数。 */
window.setupAutoStopD = setupAutoStopD;

/** @function getOriginalMaxTimeD - 暴露总时长，供外部组件计算比例尺。 */
window.getOriginalMaxTimeD = () => originalMaxTime + CONFIG.END_DELAY_SECONDS;