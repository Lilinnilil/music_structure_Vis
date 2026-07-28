const CONFIG = {
    SIDEBAR_WIDTH_RATIO: 0.20,
    MAIN_WIDTH_RATIO: 0.80,
    VIEW_B_HEIGHT_RATIO: 0.25,
    VIEW_C_HEIGHT_RATIO: 0.35,
    VIEW_D_HEIGHT_RATIO: 0.40,
    MARGIN: { top: 30, right: 30, bottom: 50, left: 50 },
    HIGHLIGHT_COLOR: "#FFD700",
    PLAYHEAD_COLOR: "#FFD700",
    END_DELAY_SECONDS: 3.0,
    SCROLLBAR_RANGE: 10000,
    PLAYHEAD_X_RATIO: 1/4, 
    FRAME_RATE: 1000 / 30,
    DISPLAY_MODE_NAMES: [
        "Piano Roll",
        "Rhythmic Framework",
        "Monophonic Melody",
        "Expanded Melody",
        "Rhythmic Melody"
    ],
    NOTE_NAMES: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
    WHITE_KEY_INDICES: [0, 2, 4, 5, 7, 9, 11],
    BLACK_KEYS_INDICES: [1, 3, 6, 8, 10],
    RHYTHM_RADIUS: 70,
    RHYTHMIC_TIME_TOLERANCE_FOR_GROUP: 0.05,
    RHYTHMIC_MAX_GROUP_DURATION_SEC: 0.35,
    RHYTHMIC_MIN_NOTES_IN_GROUP: 2,
    RHYTHMIC_MIN_REPEATS: 3,
    RHYTHMIC_INTERVAL_TO_DURATION_RATIO: 2.5,
    RHYTHMIC_HIT_TOLERANCE: 0.08
};

CONFIG.GENRE_COLORS = {
    Classical: "#4e79a7",
    Rock: "#e15759",
    Minimalism: "#59a14f",
    default: "#f28e2b"
};
CONFIG.INFO_SUFFIX = "_info.json";
CONFIG.CSV_SUFFIX = "_notes_clean.csv";
CONFIG.DEFAULT_AUDIO_EXT = ".mp3";
CONFIG.MANIFEST_JSON = "./data/manifest.json";

const FILE_PATHS = {
    FILENAME: "Peer Gynt, Suite No. 1, Op. 46 In the Hall of The Mountain King (Edvard Grieg)", 
    get NOTES_CSV() { return `../data/processed/${encodeURIComponent(this.FILENAME)}_notes_clean.csv`; }, 
    get INFO_JSON() { return `../data/processed/${encodeURIComponent(this.FILENAME)}_info.json`; }, 
    get WAV_AUDIO() { return `../data/mp3/${encodeURIComponent(this.FILENAME)}.mp3`; },
    get DISPLAY_TITLE() { return this.FILENAME.replace(/_/g, ' '); }
};

const VIRTUAL_DATA = {
    NOTES: [],
    INFO: { bpm: 120, numerator: 4, denominator: 4, ticks_per_beat: 480 }
};

function midiToNoteName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    const noteIndex = midi % 12;
    return CONFIG.NOTE_NAMES[noteIndex] + octave;
}

function lightenColor(hex, factor = 2.5) {
    if (!hex) return hex;
    try {
        let color = d3.color(hex);
        if (color) {
            factor = Math.max(1, factor);
            let lab = color.lab();
            lab.l = Math.min(95, lab.l * factor);
            return lab.toString();
        }
    } catch (e) {
        console.warn("无法解析颜色进行增亮:", hex, e);
    }
    return hex;
}

function getCoords(angle, radius) {
    return {
        x: radius * Math.cos(angle - Math.PI / 2),
        y: radius * Math.sin(angle - Math.PI / 2)
    };
}

window.CONFIG = CONFIG;
window.FILE_PATHS = FILE_PATHS;
window.VIRTUAL_DATA = VIRTUAL_DATA;
window.midiToNoteName = midiToNoteName;
window.lightenColor = lightenColor;
window.getCoords = getCoords;

CONFIG.DRAWING_WIDTH = 800 - CONFIG.MARGIN.left - CONFIG.MARGIN.right;
CONFIG.DRAWING_HEIGHT = 400 - CONFIG.MARGIN.top - CONFIG.MARGIN.bottom;