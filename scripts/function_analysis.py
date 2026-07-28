# -*- coding: utf-8 -*-
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os
import io
import music21 as m21
import json # 导入json库

# --- Global Constants ---
# 假设 info 文件名与 notes 文件名相对应
FILE_PATH = './csv/WaltzoftheFlowers_notes_clean.csv' 
INFO_PATH = FILE_PATH.replace('_notes_clean.csv', '_info.json').replace('_notes.csv', '_info.json') 
PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# --- 1. Data Loading ---

def load_info(info_path):
    """Loads and extracts essential MIDI info from the JSON file."""
    try:
        with open(info_path, 'r', encoding='utf-8') as f:
            info = json.load(f)
        # 提取 ticks_per_beat，如果不存在则使用默认值 480
        ticks_per_beat = info.get('ticks_per_beat', 480) 
        print(f"✅ Loaded ticks_per_beat: {ticks_per_beat}")
        return ticks_per_beat
    except FileNotFoundError:
        print(f" Error: Info file not found at {os.path.abspath(info_path)}. Falling back to default ticks_per_beat = 480.")
        return 480
    except Exception as e:
        print(f" Error reading info file: {e}. Falling back to default ticks_per_beat = 480.")
        return 480

def load_data():
    """Loads data and ensures correct column setup."""
    df = pd.DataFrame()
    try:
        df = pd.read_csv(FILE_PATH)
        print(f"Successfully loaded file: {FILE_PATH}")
    except FileNotFoundError:
        print(f" Error: Note CSV file not found. Check if the path is correct: {os.path.abspath(FILE_PATH)}")
        return pd.DataFrame() # Return empty DataFrame on failure
    
    # 确保列名和类型正确 (调整以匹配您的 note CSV 最终输出结构)
    # 假设最终列为: time_start_sec, duration_sec, pitch, velocity, track, instrument, track_new, time_start_tick, duration_tick
    required_cols = [
        'time_start_sec', 'duration_sec', 'pitch', 'velocity', 
        'track', 'instrument', 'track_new', 'time_start_tick', 'duration_tick'
    ]
    
    # 简单的列检查和重命名/添加
    if 'time_end_sec' not in df.columns:
        df['time_end_sec'] = df['time_start_sec'] + df['duration_sec']
        
    for col in ['pitch', 'time_start_tick', 'duration_tick']:
        if col in df.columns:
            df[col] = df[col].astype(int)

    return df

# --- 2. Core Function: Data Conversion and Music Analysis ---

def df_to_music21_score(df, ticks_per_beat):
    """
    Converts the DataFrame into a music21.stream.Score object for analysis,
    using ticks_per_beat for accurate rhythmic representation (QuarterLength).
    """
    score = m21.stream.Score()
    
    # 使用 track_new 进行分组，为每个声部创建一个 Part，提高分析准确性
    for track_name, track_df in df.groupby('track_new'):
        part = m21.stream.Part()
        part.id = track_name
        
        # 1. 计算 QuarterLength 和 Offset (核心改进)
        # QuarterLength = Ticks / Ticks_Per_Beat (MIDI PPQ 定义，Quarter Note = 1 Beat)
        track_df['quarter_length'] = track_df['duration_tick'] / ticks_per_beat
        track_df['offset_quarter'] = track_df['time_start_tick'] / ticks_per_beat
        
        # 2. 插入音符
        for _, row in track_df.iterrows():
            # 创建音符
            note = m21.note.Note(row['pitch'])
            note.volume = m21.volume.Volume(velocity=row['velocity'])
            
            # 设定持续时间 (以 QuarterLength 为单位)
            note.duration = m21.duration.Duration(row['quarter_length'])
            
            # 插入音符到 Part (以 QuarterLength 为单位的偏移量)
            part.insert(row['offset_quarter'], note) 
            
        score.append(part)
        
    return score

def analyze_harmony_and_key(df, min_duration_ticks=200):
    """
    1. Filters out short pitch-class sets using min_duration_ticks (Tick-based filtering).
    2. Performs functional harmony analysis on the filtered events.
    """
    
    # --- Step 1: Filter Chord Events (使用 Ticks 分组和过滤) ---
    
    # 根据 time_start_tick (绝对 Tick) 进行分组，精确识别同时发声的音符
    harmony_groups = df.groupby('time_start_tick').filter(lambda x: len(x) > 1).groupby('time_start_tick')
    
    chord_data = []
    for start_tick, group in harmony_groups:
        # 使用 duration_tick 的最大值进行过滤，排除持续时间过短的音符组 (NCT)
        duration_tick = group['duration_tick'].max()
        if duration_tick < min_duration_ticks:
            continue
            
        start_time_original = group['time_start_sec'].min() 
        duration_sec = group['duration_sec'].max()
        pitches = group['pitch'].tolist()
        
        # Create music21.chord.Chord object
        m21_pitches = [m21.pitch.Pitch(p) for p in pitches]
        m21_chord = m21.chord.Chord(m21_pitches)
        
        # --- Step 2: Tonality/Functional Harmony Analysis ---
        
        # 尝试功能和声分析
        try:
            # 找到最佳匹配的功能和弦
            rn = m21.harmony.chordSymbolFigureFromChord(m21_chord, includeChordType=True)
            roman_numeral = str(rn)
        except Exception:
            # 如果和弦无法识别，使用音高集合作为标签
            pitch_classes = tuple(sorted(list(set([p % 12 for p in pitches]))))
            roman_numeral = f"Unknown ({pitch_classes})"
        
        chord_data.append({
            'start_time': start_time_original,
            'duration_sec': duration_sec,
            'label': roman_numeral,
            'min_pitch': group['pitch'].min(),
            'max_pitch': group['pitch'].max()
        })

    if not chord_data:
        # Key Analysis
        chord_df = pd.DataFrame() 
    else:
        chord_df = pd.DataFrame(chord_data).sort_values(by='start_time').reset_index(drop=True)
    
    # --- Step 3: Macro Tonality Analysis (Key Detection) ---
    # 传入修正了节奏信息的 score 对象，使 Key Analysis 更加精确
    score = df_to_music21_score(df, ticks_per_beat) 
    key_analysis = score.analyze('key') # 使用 Krumhansl-Schmuckler 算法进行整体调性分析
    
    return chord_df, key_analysis

# --- 3. Visualization Function ---

def visualize_functional_analysis(df, chord_df, key_analysis, title_name):
    """
    Plots the visualization chart for functional harmony and tonality analysis.
    """
    plt.style.use('ggplot')
    
    # Adjust figure size for legend space
    fig, axes = plt.subplots(nrows=3, ncols=1, figsize=(18, 14), 
                             sharex=True, gridspec_kw={'height_ratios': [5, 1, 2]})
    
    ax1 = axes[0]
    ax2 = axes[1] # Key analysis
    ax3 = axes[2] # Harmonic span/rhythm
    
    # ----------------------------------------------------
    # Subplot 1: Piano Roll (Color coded by Pitch Class)
    # ----------------------------------------------------
    
    # Colors based on Pitch Class
    N_COLORS = 12
    color_map = plt.get_cmap('hsv', N_COLORS) 
    pitch_colors = [color_map(p / N_COLORS) for p in df['pitch'] % 12]
    
    ax1.barh(
        y=df['pitch'], 
        width=df['duration_sec'], 
        left=df['time_start_sec'], 
        height=0.8,
        color=pitch_colors, 
        edgecolor='black',
        linewidth=0.5
    )
    
    min_p = df['pitch'].min()
    max_p = df['pitch'].max()
    pitch_ticks = np.arange(min_p, max_p + 1)
    pitch_names = [f"{PITCH_NAMES[p % 12]}{p // 12 - 1}" for p in pitch_ticks]
    
    ax1.set_yticks(pitch_ticks)
    ax1.set_yticklabels(pitch_names)
    ax1.set_ylabel("Pitch")
    ax1.set_title(f"Music Functional Harmony Analysis - {title_name}", fontsize=16)
    ax1.grid(axis='x', linestyle='--')
    
    # ----------------------------------------------------
    # Overlay Functional Harmony Colors and Legend
    # ----------------------------------------------------
    if not chord_df.empty:
        # 1. Identify unique harmonies
        unique_harmonies = chord_df['label'].unique()
        N_HARMONIES = len(unique_harmonies)
        
        # 2. Assign discrete colors using 'nipy_spectral' to minimize repetition
        color_map_harmony = plt.cm.get_cmap('nipy_spectral', N_HARMONIES) 
        harmony_color_map = {label: color_map_harmony(i / N_HARMONIES) for i, label in enumerate(unique_harmonies)}
        
        legend_handles = []

        # 3. Iterate chords and color the background
        for index, row in chord_df.iterrows():
            harmony_label = row['label']
            harmony_color = harmony_color_map[harmony_label]
            
            # Apply color to the background
            ax1.axvspan(
                row['start_time'], 
                row['start_time'] + row['duration_sec'], 
                color=harmony_color, 
                alpha=0.35, # Semi-transparent to keep notes visible
                zorder=0,
                label=harmony_label if harmony_label not in [h.get_label() for h in legend_handles] else "_nolegend_"
            )
            
            # Create a proxy artist for the legend
            if harmony_label not in [h.get_label() for h in legend_handles]:
                patch = plt.Rectangle((0, 0), 1, 1, fc=harmony_color, alpha=0.5)
                patch.set_label(harmony_label)
                legend_handles.append(patch)

        # 4. Add custom legend
        ax1.legend(handles=legend_handles, title="Harmony Function", 
                   loc='upper left',          
                   bbox_to_anchor=(1.02, 1), 
                   ncol=1,
                   fontsize=10, 
                   title_fontsize=12)


    # Adjust Y axis limits
    ax1.set_ylim(min_p - 1, max_p + 1) 
    
    # ----------------------------------------------------
    # Subplot 2: Key Analysis
    # ----------------------------------------------------
    ax2.set_title("Macro Tonality (Key)")
    ax2.set_yticks([])
    ax2.set_ylim(0, 1)
    
    if key_analysis:
        key_name = key_analysis.name
        ax2.text(0.5, 0.5, f"Main Key: {key_name}", 
                 transform=ax2.transAxes, 
                 ha='center', 
                 va='center', 
                 fontsize=14, 
                 bbox=dict(boxstyle="round,pad=0.5", fc="lightblue", alpha=0.5))
    else:
        ax2.text(0.5, 0.5, "Key Analysis Unavailable (Insufficient Data or music21 Missing)", 
                 transform=ax2.transAxes, ha='center', va='center', fontsize=12)

    # ----------------------------------------------------
    # Subplot 3: Harmonic Rhythm and Pitch Span (Color coded by Span)
    # ----------------------------------------------------
    ax3.set_title("Harmonic Rhythm and Pitch Span")
    
    if not chord_df.empty:
        span_heights = chord_df['max_pitch'] - chord_df['min_pitch']
        
        # Use 'plasma' colormap, color coded by pitch span (complexity)
        norm = plt.Normalize(span_heights.min(), span_heights.max())
        span_colors = plt.cm.plasma(norm(span_heights)) 
        
        ax3.bar(
            x=chord_df['start_time'],
            height=span_heights, 
            width=chord_df['duration_sec'],
            bottom=0, 
            align='edge',
            color=span_colors, 
            alpha=0.8,
            edgecolor='black',
            linewidth=0.5
        )
        
        ax3.set_ylabel("Pitch Span (Complexity)") 
        # Ensure y-ticks cover the full range of span heights
        max_span = span_heights.max()
        ax3.set_yticks(np.arange(0, max_span + 1, max(1, round(max_span / 6))))
        
        # Add a Color Bar legend
        sm = plt.cm.ScalarMappable(cmap='plasma', norm=norm)
        sm.set_array([]) 
        cbar = fig.colorbar(sm, ax=ax3, orientation='vertical', pad=0.01)
        cbar.set_label('Pitch Span (Semitones)')
    else:
        ax3.text(0.5, 0.5, "Insufficient harmony data for rhythm/span analysis.", 
                 transform=ax3.transAxes, ha='center', va='center', fontsize=12)


    # Overall settings
    max_time = df['time_end_sec'].max()
    ax3.set_xlim(0, max_time * 1.05)
    ax3.set_xlabel("Time (seconds)")
    
    # Adjust layout to accommodate the legend
    plt.tight_layout(rect=[0, 0, 0.88, 1]) 
    plt.show()

# --- 4. Run Analysis ---
if __name__ == "__main__":
    try:
        # 1. 加载 Info 文件以获取 ticks_per_beat
        ticks_per_beat = load_info(INFO_PATH)
        
        # 2. 加载 Note 数据
        df = load_data()
        
        if not df.empty:
            # 传入ticks per beat
            chord_df, key_analysis = analyze_harmony_and_key(df, min_duration_ticks=ticks_per_beat / 4) # 默认过滤时长低于十六分音符的音
            
            title_name = os.path.basename(FILE_PATH).replace(".csv", "")
            visualize_functional_analysis(df, chord_df, key_analysis, title_name)
        else:
            print("Failed to load any note data.")
            
    except ImportError:
        print("\n--- Error Message ---")
        print("To run this file, you need to install the music21 library.")
        print("Please run: pip install music21")
        print("------------------")
    except Exception as e:
        print(f"An error occurred during execution: {e}")