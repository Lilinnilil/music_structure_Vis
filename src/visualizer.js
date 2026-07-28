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
let visualizerNotes = [];
let lineAnchorCache = [];
let lineAnchorByTrack = new Map();
let lineAnchorsDirty = true;
let showPercussion = true;
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

togglePlaybackCallback = () => console.error("Toggle playback callback not set in visualizer.");

// Track stroke-width mapping (adjustable)
const TRACK_MIN_STROKE = 0.8;
const TRACK_MAX_STROKE = 5.0;

colorScale = null;
xScale = null;
yScale = null; 
xAxisGroup = null;
yAxisGroup = null;
timeLabel = null;
displayMode = 0;
statusButton = d3.select("#playPauseBtn");
toggleDisplayModeButton = d3.select("#toggleDisplayModeBtn");
togglePercussionButton = d3.select("#togglePercussionBtn");
xScrollbar = document.getElementById("x-scrollbar");

TRANSLATION_PIXEL_RANGE = 0;
svg = null;
playheadX = 0;
chartGroup = null;
barLabelGroup = null;

function setupDefs() {
    const defs = svg.append("defs");

    // 謦ｭ謾ｾ螟ｴ貂仙序
    const playheadGradient = defs.append("linearGradient")
        .attr("id", "playheadGradient")
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
    playheadGradient.append("stop").attr("offset", "0%").attr("stop-color", CONFIG.HIGHLIGHT_COLOR).attr("stop-opacity", 0.1);
    playheadGradient.append("stop").attr("offset", "100%").attr("stop-color", CONFIG.PLAYHEAD_COLOR).attr("stop-opacity", 0.9);

    // 霎牙・貊､髟・
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

function drawLegend(trackNames) {
    const legendContainer = d3.select("#legend");
    legendContainer.selectAll(".legend-item").remove();
    // 蛻・ｦｻ percussion 蜥・melodic tracks
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
    // Percussion tracks・育區濶ｲ・・
    const percussionItems = legendContainer.selectAll(".legend-item-percussion")
        .data(percussionTracks)
        .enter()
        .append("div")
        .attr("class", "legend-item legend-item-percussion");
    percussionItems.append("div")
        .attr("class", "legend-color")
        .style("background-color", "white");
    percussionItems.append("span").text(d => d);
    // 蛻晏ｧ狗憾諤∽ｽｿ謇譛牙崟萓狗・蠎ｦ/菴朱乗・蠎ｦ
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

function normalizeNotesData(notesData) {
    if (!Array.isArray(notesData)) return [];
    return notesData.map((note) => {
        const normalized = { ...note };
        const numericFields = ['time_start_sec', 'duration_sec', 'pitch', 'velocity', 'time_start_tick', 'duration_tick'];
        numericFields.forEach((field) => {
            const rawValue = normalized[field];
            const parsed = rawValue === '' || rawValue === null || rawValue === undefined ? 0 : Number(rawValue);
            normalized[field] = Number.isFinite(parsed) ? parsed : 0;
        });
        const rawEndTime = normalized.time_end_sec;
        const parsedEndTime = rawEndTime === '' || rawEndTime === null || rawEndTime === undefined ? NaN : Number(rawEndTime);
        normalized.time_end_sec = Number.isFinite(parsedEndTime) ? parsedEndTime : NaN;
        if (!Number.isFinite(normalized.time_end_sec) || normalized.time_end_sec <= normalized.time_start_sec) {
            normalized.time_end_sec = normalized.time_start_sec + normalized.duration_sec;
        }
        return normalized;
    });
}

function drawPianoRollElements(notes) {
    lineAnchorsDirty = true;
    const normalizedNotes = normalizeNotesData(notes);
    if (!normalizedNotes || !normalizedNotes.length) return;

    const min_pitch = d3.min(normalizedNotes, d => d.pitch);
    const max_pitch = d3.max(normalizedNotes, d => d.pitch);
    const safeHeight = Math.max(120, CONFIG.DRAWING_HEIGHT || 240);
    const safeWidth = Math.max(200, CONFIG.DRAWING_WIDTH || 800);
    
    // Y 豈比ｾ句ｰｺ蜥碁浹隨ｦ鬮伜ｺｦ
    yScale = d3.scaleLinear().domain([min_pitch - 1, max_pitch + 1]).range([safeHeight, 0]);
    const rectHeight = safeHeight / (max_pitch - min_pitch + 2);
    const pitchRange = d3.range(min_pitch, max_pitch + 1, 1);

    // 貂・炊譌ｧ逧・ｽｴ蜥梧・ｭｾ
    svg.selectAll(".axis, .C4-label, .bar-label").remove();

    // 扈伜宛鮟鷹醗閭梧勹
    chartGroup.selectAll(".black-key-bg").data(pitchRange).enter().insert("rect", ":first-child")
        .attr("class", "black-key-bg").attr("y", d => yScale(d + 0.5) - rectHeight / 2).attr("x", 0)
        .attr("width", Math.max(1, xScale(originalMaxTime + CONFIG.END_DELAY_SECONDS) || safeWidth)).attr("height", rectHeight).filter(d => CONFIG.BLACK_KEYS_INDICES.includes(d % 12));

    // 扈伜宛逋ｽ髞ｮ鄂第ｼ郤ｿ
    chartGroup.selectAll(".grid-line-y").data(pitchRange.filter(d => CONFIG.WHITE_KEY_INDICES.includes(d % 12))).enter().insert("line", ":first-child")
        .attr("class", "grid-line grid-line-y").attr("x1", 0).attr("x2", Math.max(1, xScale(originalMaxTime + CONFIG.END_DELAY_SECONDS) || safeWidth)).attr("y1", d => yScale(d) + rectHeight / 2).attr("y2", d => yScale(d) + rectHeight / 2);

    // 扈伜宛蟆剰鰍/闃よ牛郤ｿ
    const beatTicks = d3.range(0, originalMaxTime + CONFIG.END_DELAY_SECONDS, beatDurationSec);
    const barTicks = d3.range(0, originalMaxTime + CONFIG.END_DELAY_SECONDS, barDurationSec);

    chartGroup.selectAll(".beat-line").data(beatTicks).enter().insert("line", ":first-child")
        .attr("class", "beat-line").attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", CONFIG.DRAWING_HEIGHT);

    chartGroup.selectAll(".bar-line").data(barTicks).enter().insert("line", ":first-child")
        .attr("class", "bar-line").attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", CONFIG.DRAWING_HEIGHT);
    
    // 扈伜宛蟆剰鰍譬・ｭｾ
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

    // 扈伜宛譌ｶ髣ｴ霓ｴ
    xAxisGroup = svg.append("g").attr("class", "axis x-axis-flow").attr("transform", `translate(0,${CONFIG.DRAWING_HEIGHT})`)
        .call(d3.axisBottom(xScale).tickFormat(d => `${d.toFixed(1)}s`).tickSize(0).tickPadding(10).tickValues(barTicks));

    // 扈伜宛髻ｳ鬮倩ｽｴ
    yAxisGroup = svg.append("g").attr("class", "axis y-axis-flow").call(d3.axisLeft(yScale).tickValues(pitchRange.filter(d => CONFIG.WHITE_KEY_INDICES.includes(d % 12))).tickFormat(midi => midiToNoteName(midi)).tickSize(0).tickPadding(8));
    yAxisGroup.selectAll(".tick").filter(d => d === 60).select("text").attr("class", "C4-label");

    // 扈伜宛譌ｶ髣ｴ譬・ｭｾ
    timeLabel = svg.append("text").attr("x", playheadX).attr("y", CONFIG.DRAWING_HEIGHT + CONFIG.MARGIN.bottom - 10).style("text-anchor", "middle").attr("fill", CONFIG.HIGHLIGHT_COLOR).style("font-size", "14px").style("font-weight", "bold").text("0.00s");

    // 扈伜宛髻ｳ隨ｦ遏ｩ蠖｢
    chartGroup.selectAll(".note")
        .data(normalizedNotes)
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


    // --- 扈伜宛髻ｳ霓ｨ霑樒ｺｿ ---
    // Keep melodic lines free of percussion: separate notes collection
    const NON_PERCUSSION_NOTES = normalizedNotes.filter(d => !isPercussionTrack(d.track_new));

    const LONG_ABSENCE_BARS = 0.25;
    const BAR_THRESHOLD = LONG_ABSENCE_BARS * barDurationSec;
    const MIN_ABSOLUTE_THRESHOLD = 0.5;
    const FINAL_THRESHOLD = Math.max(BAR_THRESHOLD, MIN_ABSOLUTE_THRESHOLD);
    
    const notesByTrackAll = d3.group(normalizedNotes, d => d.track_new);
    const notesByTrack = d3.group(NON_PERCUSSION_NOTES, d => d.track_new);
    
    const allVoiceSegments = []; 
    const allRhythmicGroups = []; // { trackName, time, minPitch, maxPitch, notes }

    // 1) Rhythmic/arpeggio detection - 蛻帛ｻｺ謇譛蛾浹霓ｨ逧・鰍螂冗ｻ・
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

    // === 逅ｶ髻ｳ譽豬矩ｻ霎・(謠仙燕螳壻ｹ・connectedSet) ===
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
    const LONG_NOTE_DURATION_THRESHOLD = 0.43; // 蟄､遶矩柄髻ｳ髦亥ｼ・・.43 遘・

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

    // 3) 蟄､遶矩柄髻ｳ Line Generation (start -> end) - 蜊暮浹
    NON_PERCUSSION_NOTES.forEach(n => {
        // 譽譟･譏ｯ蜷ｦ・壽悴蜿ゆｸ主､夐浹隨ｦ螢ｰ驛ｨ霑樒ｺｿ AND 譛ｪ蜿ゆｸ手鰍螂冗ｻ・AND 謖∫ｻｭ譌ｶ髣ｴ雜・ｿ・・蛟ｼ
        if (!voiceNoteSet.has(n) && !rhythmicNoteSet.has(n)) {
            if ((n.duration_sec || 0) >= LONG_NOTE_DURATION_THRESHOLD) {
                // 蟄､遶矩柄髻ｳ・喙duration襍ｷ轤ｹ] -> [duration扈育せ]
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
    // 4) 蟄､遶矩柄髻ｳ Rhythmic Group Line Generation (逕ｨ莠・Arpeggio Melody Mode)
    //    譁ｰ騾ｻ霎托ｼ壻ｻ・ｯｹ扈・・ duration 雜・ｿ・・蛟ｼ逧・黒髻ｳ隨ｦ扈伜宛髟ｿ郤ｿ縲・
    // =========================================================================
    allRhythmicGroups.forEach(g => {
        const tnl = g.trackName.toLowerCase();
        
        // 1. 謗帝勁謇灘・荵宣浹霓ｨ
        if (isPercussionTrack(g.trackName)) {
            return;
        }
        // 2. 謗帝勁蟾ｲ霑樊磁謌千生髻ｳ蠎丞・逧・ｻ・(霑樊磁逧・生髻ｳ蠎丞・逕ｱ豁･鬪､ 3 逧・arpeggio-line 螟・炊)
        if (connectedSet.has(`${g.trackName}-${g.time}`)) {
            return;
        }

        // 3. 驕榊紙扈・・豈丈ｸｪ髻ｳ隨ｦ・悟ｹｶ譽譟･蜈ｶ謖∫ｻｭ譌ｶ髣ｴ
        g.notes.forEach((n, noteIndex) => {
            // 譽譟･隸･髻ｳ隨ｦ譏ｯ蜷ｦ荳ｺ髟ｿ髻ｳ・・uration 雜・ｿ・・蛟ｼ・・
            if ((n.duration_sec || 0) >= LONG_NOTE_DURATION_THRESHOLD) {
                
                // 扈伜宛蜊穂ｸｪ髻ｳ隨ｦ逧・ｭ､遶矩柄逅ｶ髻ｳ郤ｿ (莉主ｼ蟋区慮髣ｴ蛻ｰ扈捺據譌ｶ髣ｴ)
                allVoiceSegments.push({
                    trackName: n.track_new,
                    // 菴ｿ逕ｨ蜚ｯ荳逧・ID・碁亟豁｢荳主・莉・segments 蜀ｲ遯・
                    voiceId: `${n.track_new}-arp-long-note-${n.time_start_sec}-${n.pitch}-${noteIndex}`, 
                    segments: [{
                        x1: xScale(n.time_start_sec),
                        y1: yScale(n.pitch),
                        x2: xScale(n.time_end_sec),
                        y2: yScale(n.pitch), // 菫晄戟髻ｳ鬮倅ｸ榊序
                        timeStart: n.time_start_sec,
                        timeEnd: n.time_end_sec,
                        velocity: n.velocity || 0,
                    }],
                    avgVelocity: n.velocity || 0, 
                    isIsolatedArpGroup: true // <--- 蜈ｳ髞ｮ譬・ｮｰ・夂畑莠・D3 扈大ｮ壽慮豺ｻ蜉 class
                });
            }
        });
    });
    // =========================================================================

    // 5) D3 扈大ｮ夲ｼ壻ｽｿ逕ｨ譁ｰ逧・segment 謨ｰ謐ｮ扈捺桷蜥瑚・螳壻ｹ芽ｷｯ蠕・函謌仙勣
    
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
        // === 蜈ｳ髞ｮ菫ｮ謾ｹ・壽ｹ謐ｮ譬・ｮｰ豺ｻ蜉荳榊酔逧・class ===
        .attr("class", d => "track-line" + (d.isIsolatedArpGroup ? " arp-long-group-line" : ""))
        // ======================================
        .attr("fill", "none")
        .attr("stroke", d => isPercussionTrack(d.trackName) ? "white" : lightenColor(colorScale(d.trackName), 1.0))
        .attr("d", segmentPathGenerator);
        
    // Create highlight points for each track line (initially hidden)
    chartGroup.selectAll(".line-highlight-point")
        .data(allVoiceSegments, d => d.voiceId) // Bind data by unique voice ID
        .join("circle")
        // === 蜈ｳ髞ｮ菫ｮ謾ｹ・壼怕逅・ｹ滓ｷｻ蜉蟇ｹ蠎皮噪 class (.arp-long-group-line-highlight) ===
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
    // 縲伸ines Mode Display - 謗帝勁謇灘・荵舌・ 霑・ｻ､闃ょ･冗ｺｿ蜥碁ｫ倅ｺｮ遏ｩ蠖｢逧・焚謐ｮ貅撰ｼ梧賜髯､謇灘・荵宣浹霓ｨ縲・
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
        // 縲伸ines Mode Display - 謗帝勁謇灘・荵舌・ 霑・ｻ､ Arpeggio 霑樒ｺｿ謨ｰ謐ｮ貅撰ｼ梧賜髯､謇灘・荵宣浹霓ｨ縲・
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
    const percussionNotes = normalizedNotes.filter(d => isPercussionTrack(d.track_new));

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
    // Arpeggio highlight points莉・惠 Expanded Melody 荳ｭ螻慕､ｺ・娥onophonic 荳榊ｱ慕､ｺ
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
    
    updateVisualizer(Tone.Transport.state === 'stopped', false);
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
    
    updateVisualizer(false, true);

    window.dispatchEvent(new CustomEvent('timejump', { detail: { time: currentTime } }));
}

function setupVisualizerAutoStop() {
    if (transportScheduleId !== null) { Tone.Transport.clear(transportScheduleId); }
    const stopTime = originalMaxTime + CONFIG.END_DELAY_SECONDS;
    transportScheduleId = Tone.Transport.scheduleOnce(() => {
        Tone.Transport.stop(); 
    }, stopTime);
}

function togglePlayback() {
    if (!allAssetsLoaded) return;
    if (typeof togglePlaybackCallback === 'function') {
        togglePlaybackCallback();
    }
}


function animate() {
    const shouldAnimate = (window.__VISUALIZER_PLAYBACK_ACTIVE__ === true) || Tone.Transport.state === 'started';
    if (!shouldAnimate) {
        clearTimeout(vizUpdateLoop);
        vizUpdateLoop = null;
        return;
    }

    // This is the core animation loop
    updateVisualizer(false, false);

    vizUpdateLoop = setTimeout(animate, CONFIG.FRAME_RATE);
}

function updateVisualizer(isStopping = false, skipGlowUpdates = false) { 
    const TOLERANCE = 0.05;
    if (!xScale || !xAxisGroup) return;

    // --- Update time and position ---
    const isPlaybackActive = (window.__VISUALIZER_PLAYBACK_ACTIVE__ === true) || Tone.Transport.state === 'started';
    if (isStopping) {
        currentTime = 0;
        currentTranslationX = maxTranslationX;
        updateScrollbarValue();
        clearTimeout(vizUpdateLoop);
        vizUpdateLoop = null;
    } else if (isPlaybackActive && !skipGlowUpdates) {
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
            const activeNoteData = notes.filter(function(d) {
                return d.time_start_sec - TOLERANCE <= currentTime && d.time_end_sec > currentTime - TOLERANCE;
            });
            activeNoteData.each(function(d) {
                d3.select(this)
                    .classed("glow", true)
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

            // Expanded Melody: hide flashing circles・御ｻ・ｿ晉蕗霑樒ｻｭ蝨・帥
            if (isExpandedMelody) {
                // Hide all flashing circles in Melody mode
                chartGroup.selectAll('.arpeggio-hit-circle').style('opacity', 0);
                chartGroup.selectAll('.beat-hit-circle').style('opacity', 0);
                chartGroup.selectAll('.rhythmic-highlight-circle').style('opacity', 0);
            }

            // Rhythmic Melody: 蜿ｪ菫晉蕗豼豢ｻ髣ｪ辜・ｼ域裏霑樒ｻｭ蝨・帥・・
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

                // ... (蜈ｶ莉匁ｷ蠑乗峩譁ｰ騾ｻ霎台ｿ晄戟荳榊序) ...

                // 4) Move arpeggio highlight points along their path (莉・Expanded Melody 譏ｾ遉ｺ)
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

                // ... (逅ｶ髻ｳ鬮倅ｺｮ轤ｹ逧・ｷ蠑乗峩譁ｰ騾ｻ霎台ｿ晄戟荳榊序) ...

                // Move and style highlight points for long-note segments (arp-melody segments) (逡･...)
                const arpMelHighlights = chartGroup.selectAll('.arp-melody-highlight-point');
                arpMelHighlights.each(function(d) {
                    const pt = d3.select(this);
                    if (!d) { pt.style('opacity', 0); return; }
                    // if playhead outside segment, hide
                    if (currentTime < d.start || currentTime > d.end + TOLERANCE) { pt.style('opacity', 0); return; } // [FIX 2d]: 菴ｿ逕ｨ螳ｹ蠢榊ｺｦ

                    const cx = xScale(currentTime);
                    const cy = yScale(d.pitch);

                    // ... (隶｡邂怜濠蠕・柱騾乗・蠎ｦ騾ｻ霎台ｿ晄戟荳榊序) ...

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
        // percussion track 蜊慕峡螟・炊
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
    
    const shouldAnimate = (window.__VISUALIZER_PLAYBACK_ACTIVE__ === true) || Tone.Transport.state === 'started';
    if (shouldAnimate && !vizUpdateLoop) {
        setTimeout(animate, 0);
    }
    
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
            updateVisualizer(false, true); 
        }
    })
    .on("end", function(event) {
        if (Tone.Transport.state !== 'started') {
            updateVisualizer(false, false); 
        }
    });


// --- 4. 譬ｸ蠢・・蟋句喧蜃ｽ謨ｰ (Visualizer) ---

/**
 * 證ｴ髴ｲ扈・app.js・咼 隗・崟逧・・蟋句喧蜈･蜿｣縲・
 */
async function initVisualizer(containerId, notesData, infoData, maxTime, audioPlayerInstance, callbacks) {
    const normalizedNotes = normalizeNotesData(notesData);
    visualizerNotes = normalizedNotes; // Store notes data locally
    
    // 闔ｷ蜿門ｮｹ蝎ｨ逧・ｮ樊慮蟆ｺ蟇ｸ
    const containerNode = document.getElementById(containerId.replace('#', ''));
    const fallbackWidth = 900;
    const fallbackHeight = 420;
    let innerWidth = (containerNode && containerNode.clientWidth > 10 ? containerNode.clientWidth : fallbackWidth) - CONFIG.MARGIN.left - CONFIG.MARGIN.right;
    let innerHeight = (containerNode && containerNode.clientHeight > 10 ? containerNode.clientHeight : fallbackHeight) - CONFIG.MARGIN.top - CONFIG.MARGIN.bottom;

    // --- 蜈ｳ髞ｮ Debug 譽譟･蜥悟ｰｺ蟇ｸ菫ｮ螟・---
    if (!containerNode || containerNode.clientWidth <= 10 || containerNode.clientHeight <= 10) {
        console.warn(`[Visualizer Debug] 螳ｹ蝎ｨ ${containerId} 蟆ｺ蟇ｸ蠑ょｸｸ・御ｽｿ逕ｨ蝗樣蟆ｺ蟇ｸ ${fallbackWidth}x${fallbackHeight}縲Ａ);
        innerWidth = fallbackWidth - CONFIG.MARGIN.left - CONFIG.MARGIN.right;
        innerHeight = fallbackHeight - CONFIG.MARGIN.top - CONFIG.MARGIN.bottom;
    }
    // ---------------------------------

    CONFIG.DRAWING_WIDTH = innerWidth;
    CONFIG.DRAWING_HEIGHT = innerHeight;
    
    const outerWidth = innerWidth + CONFIG.MARGIN.left + CONFIG.MARGIN.right;
    const outerHeight = innerHeight + CONFIG.MARGIN.top + CONFIG.MARGIN.bottom;

    // 遘ｻ髯､譌ｧ逧・SVG
    d3.select(containerId).select('svg').remove();

    // 蛻帛ｻｺ荳ｻ SVG 蜈・ｴ
    const container = d3.select(containerId);
    container.selectAll('svg').remove();
    svg = container
        .append("svg")
        .attr("width", outerWidth)
        .attr("height", outerHeight)
        .attr("class", "draggable-chart")
        .style("display", "block")
        .append("g")
        .attr("transform", `translate(${CONFIG.MARGIN.left},${CONFIG.MARGIN.top})`);
        
    playheadX = CONFIG.DRAWING_WIDTH * CONFIG.PLAYHEAD_X_RATIO;
    chartGroup = svg.append("g").attr("class", "chart-group");
    barLabelGroup = svg.append("g").attr("class", "bar-label-group");

    // 蛻帛ｻｺ豬ｮ蜉ｨ謠千､ｺ譯・ｼ亥・螻・御ｻ・ｸ谺｡・・
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
    
    // 隶ｾ鄂ｮ蝗櫁ｰ・柱髻ｳ鬚大ｼ慕畑
    togglePlaybackCallback = callbacks.togglePlayback;
    audioPlayer = audioPlayerInstance;

    // --- 髻ｳ荵宣・鄂ｮ ---
    currentBPM = infoData.bpm || 120;
    beatNumerator = infoData.numerator || 4;
    const beatDenominator = infoData.denominator || 4;
    
    Tone.Transport.bpm.value = currentBPM;
    Tone.Transport.timeSignature = [beatNumerator, beatDenominator];

    beatDurationSec = (60 / currentBPM) * (4 / beatDenominator);
    barDurationSec = beatDurationSec * beatNumerator;


    // 髻ｳ霓ｨ蜷咲ｧｰ蜥碁｢懆牡豈比ｾ句ｰｺ
    const trackNames = Array.from(new Set(normalizedNotes.map(d => d.track_new)));
    // 蛻帛ｻｺ colorScale 譌ｶ謗帝勁 percussion
const melodicTrackNames = trackNames.filter(t => !isPercussionTrack(t));
colorScale = d3.scaleOrdinal().domain(melodicTrackNames).range(d3.schemeTableau10);
    drawLegend(trackNames);

    // --- 豈比ｾ句ｰｺ螳壻ｹ・---
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
    
    // 遑ｮ菫晄ｻ壼勘譚｡莠倶ｻｶ蜿ｪ扈大ｮ壻ｸ谺｡
    if (!xScrollbar.hasListener) {
        xScrollbar.addEventListener('input', handleScrollbarInput);
        xScrollbar.hasListener = true;
    }
    // --- 豈比ｾ句ｰｺ螳壻ｹ・(扈捺據) ---


    // 扈伜宛譬ｸ蠢・・邏
    setupDefs();
    drawPlayhead();
    drawPianoRollElements(normalizedNotes);


    allAssetsLoaded = true;
    statusButton.text("笆ｶ Play");
    if (window.__VISUALIZER_APP__) {
        statusButton.on("click", null);
    } else {
        statusButton.on("click", () => {
            if (typeof togglePlayback === 'function') {
                togglePlayback();
            }
        });
    }
    toggleDisplayModeButton.on("click", toggleDisplayMode); // 遑ｮ菫晉ｻ大ｮ・
    if (togglePercussionButton && !togglePercussionButton.empty()) {
        togglePercussionButton.on("click", () => {
            showPercussion = !showPercussion;
            updatePercussionButtonLabel();
            applyDisplayMode();
        });
        updatePercussionButtonLabel();
    }
    // 蛻晏ｧ句喧菴咲ｽｮ
    currentTranslationX = maxTranslationX;	
    chartGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    xAxisGroup.attr("transform", `translate(${currentTranslationX}, ${CONFIG.DRAWING_HEIGHT})`);
    barLabelGroup.attr("transform", `translate(${currentTranslationX}, 0)`);
    
    updateScrollbarValue();	
    
    // 蛻晏ｧ狗憾諤∬ｿ占｡御ｸ谺｡螳梧紛逧・updateViz
    updateVisualizer(false, false);
    
    // Apply the initial display mode to hide lines by default
    applyDisplayMode();

    svg.call(dragHandler);
}


// --- 證ｴ髴ｲ蜈ｨ螻謗･蜿｣ (萓・app.js 蜊剰ｰ・勣隹・畑) ---

/** @function initVisualizer - D 隗・崟逧・・蟋句喧蜃ｽ謨ｰ縲・*/
window.initVisualizer = initVisualizer;

/** @function updateVisualizer - D 隗・崟逧・勘逕ｻ/蜷梧ｭ･譖ｴ譁ｰ蜃ｽ謨ｰ縲・*/
window.updateVisualizer = updateVisualizer;

/** @function setupVisualizerAutoStop - 隶ｾ鄂ｮ謦ｭ謾ｾ閾ｪ蜉ｨ蛛懈ｭ｢逧・・謨ｰ縲・*/
window.setupVisualizerAutoStop = setupVisualizerAutoStop;

/** @function getVisualizerMaxTime - 證ｴ髴ｲ諤ｻ譌ｶ髟ｿ・御ｾ帛､夜Κ扈・ｻｶ隶｡邂玲ｯ比ｾ句ｰｺ縲・*/
window.getVisualizerMaxTime = () => originalMaxTime + CONFIG.END_DELAY_SECONDS;
