# -*- coding: utf-8 -*-
import mido
import pandas as pd
import os
import math
import sys
import re
import json
import glob
from collections import defaultdict

# --- 1. 常量和配置 ---

MIDI_INSTRUMENT_NAMES = [
    # Piano (0-7)
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
    'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
    # Chromatic Percussion (8-15)
    'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone',
    'Tubular Bells', 'Dulcimer',
    # Organ (16-23)
    'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ',
    'Accordion', 'Harmonica', 'Tango Accordion',
    # Guitar (24-31)
    'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)',
    'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar',
    'Distortion Guitar', 'Guitar Harmonics',
    # Bass (32-39)
    'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
    'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
    # Strings (40-47)
    'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings',
    'Orchestral Harp', 'Timpani',
    # Ensemble (48-55)
    'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
    'Choir Aahs', 'Voice Oohs', 'Synth Choir', 'Orchestra Hit',
    # Brass (56-63)
    'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section',
    'Synth Brass 1', 'Synth Brass 2',
    # Reed (64-71)
    'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn',
    'Bassoon', 'Clarinet',
    # Pipe (72-79)
    'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi',
    'Whistle', 'Ocarina',
    # Synth Lead (80-87)
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
    'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
    # Synth Pad (88-95)
    'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
    'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
    # Synth Effects (96-103)
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
    'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
    # Ethnic (104-111)
    'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    # Percussive (112-119)
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom',
    'Synth Drum', 'Reverse Cymbal',
    # Sound Effects (120-127)
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring',
    'Helicopter', 'Applause', 'Gunshot'
]

VOCAL_MAP = {
    'soprano': 'Soprano',
    'alto': 'Alto',
    'tenor': 'Tenor',
    'bass': 'Bass',
    'choir': 'Choir',
    'chorus': 'Choir',
    'voice': 'Voice',
    'vocal': 'Voice',
    'satb': 'Choir',
    'aahs': 'Choir',
    'oohs': 'Choir'
}

INSTRUMENT_MAP = {
    # 精确映射
    'violin': 'Violin',
    'violini':'Violin',
    'viola': 'Viola',
    'viole': 'Viola',
    'violoncelli':'Cello',
    'cello': 'Cello',
    'contrabass': 'Contrabass',
    'contrabbassi': 'Contrabass',
    'pizzicatostrings': 'Pizzicato Strings',
    'pizzicato': 'Pizzicato Strings',
    'flute': 'Flute',
    'piccolo': 'Piccolo',
    'oboe': 'Oboe',
    'englishhorn': 'English Horn',
    'clarinet': 'Clarinet',
    'bassoon': 'Bassoon',
    'trumpet': 'Trumpet',
    'frenchhorn': 'French Horn',
    'trombone': 'Trombone',
    'tuba': 'Tuba',
    'harpsichord': 'Harpsichord',
    'piano': 'Piano',
    'pianoforte':'Piano',
    'acousticgrandpiano': 'Piano',
    'electricpiano': 'Electric Piano',
    'churchorgan': 'Organ',
    'drawbarorgan': 'Organ',
    'orchestralharp': 'Harp',
    'timpani': 'Timpani',
    'saxophone': 'Saxophone',
    'sax': 'Saxophone',
    # 族群/通用映射
    'strings': 'Strings',
    'woodwind': 'Woodwind',
    'brass': 'Brass Section',
    'keyboard': 'Keyboard',
    'percussion/kit': 'Percussion/Kit',
    'stringensemble': 'Strings',
    'synthstrings': 'Strings',
    'brasssection': 'Brass Section',
    'tremolostrings': 'Strings',
    'acousticguitar': 'Guitar',
    'electricguitar': 'Guitar',
    'synthbass': 'Bass',
    'synthbrass': 'Brass Section',
    'synthchoir': 'Choir',
    'acousticbass': 'Acoustic Bass',
    'electricbass': 'Electric Bass',
    'fretlessbass': 'Fretless Bass',
    'bassstrings': 'Strings'
}

def get_instrument_name(program_number):
    if 0 <= program_number < len(MIDI_INSTRUMENT_NAMES):
        return MIDI_INSTRUMENT_NAMES[program_number]
    return f"Instrument_{program_number}"

def get_base_instrument_name(inst_with_num):
    return re.sub(r' _ \d+$', '', inst_with_num)

def get_instrument_family(instrument_name):
    name = instrument_name.lower().replace(' ', '').replace('_', '').replace('1', '').replace('2', '')
    if 'violin' in name or 'viola' in name or 'cello' in name or 'contrabass' in name or 'strings' in name or 'ensemble' in name or 'pizzicato' in name:
        return 'strings'
    if 'flute' in name or 'oboe' in name or 'clarinet' in name or 'bassoon' in name or 'sax' in name:
        return 'woodwind'
    if 'trumpet' in name or 'trombone' in name or 'tuba' in name or 'horn' in name or 'brass' in name:
        return 'brass'
    if 'harpsichord' in name or 'piano' in name or 'organ' in name or 'celesta' in name:
        return 'keyboard'
    if 'choir' in name or 'voice' in name or 'aahs' in name or 'oohs' in name:
        return 'vocal'
    if 'timpani' in name or 'drum' in name or 'percussion' in name or 'kit' in name:
        return 'percussion/kit'
    return name

def clean_instrument_name(name):
    if isinstance(name, str):
        return re.sub(r'[\s_\d-]', '', name).lower()
    return str(name).lower()

def find_keyword_match(text, instrument_map):
    if not isinstance(text, str):
        return None
    cleaned_text = re.sub(r'[\s-]', '', text).lower()
    for key, normalized_name in instrument_map.items():
        if key in cleaned_text:
            return normalized_name
    return None

def calculate_sequence_similarity(notes1_df, notes2_df):
    if notes1_df.empty or notes2_df.empty:
        return 0.0
    set1 = set(tuple(x) for x in notes1_df[['pitch', 'time_start_tick', 'duration_tick']].values)
    set2 = set(tuple(x) for x in notes2_df[['pitch', 'time_start_tick', 'duration_tick']].values)
    intersection_size = len(set1.intersection(set2))
    min_size = min(len(set1), len(set2))
    if min_size == 0:
        return 0.0
    return intersection_size / min_size

def compute_music_metrics(df, total_duration_sec):
    """计算整体的演奏强度、音色复杂度和和声/音符密度。"""
    if df is None or df.empty:
        return {
            'avg_velocity': 0.0,
            'timbre_complexity': 0.0,
            'harmonic_complexity': 0.0
        }
    # 平均力度（Velocity）
    avg_velocity = float(df['velocity'].mean())

    # Timbre 复杂度：使用基于音色（instrument_raw）的香农熵，按出现次数加权。
    inst_counts = df['instrument_raw'].value_counts()
    total_notes = inst_counts.sum()
    timbre_complexity = 0.0
    if total_notes > 0 and len(inst_counts) > 1:
        probs = inst_counts / total_notes
        entropy = -float((probs * probs.apply(math.log2)).sum())
        max_entropy = math.log2(len(inst_counts))
        if max_entropy > 0:
            timbre_complexity = entropy / max_entropy

    # 和声复杂度 / 音符密度：用音符数 / 总时长 (notes per second) 作为密度指标。
    harmonic_complexity = float(len(df) / total_duration_sec) if total_duration_sec > 0 else 0.0

    return {
        'avg_velocity': avg_velocity,
        'timbre_complexity': timbre_complexity,
        'harmonic_complexity': harmonic_complexity
    }

def generate_original_df(midi_file_path):
    try:
        midi = mido.MidiFile(midi_file_path)
    except Exception as e:
        print(f"❌ 错误：无法打开或读取 MIDI 文件 {midi_file_path}。详情: {e}")
        return None, 0, 4, 4, 0, 0
    notes_list = []
    ticks_per_beat = midi.ticks_per_beat
    tempo_changes = [(0, 500000)]
    numerator = 4
    denominator = 4
    channel_instruments = {i: 0 for i in range(16)}
    for track in midi.tracks:
        abs_tick_track = 0
        for msg in track:
            abs_tick_track += msg.time
            if msg.type == 'program_change' and hasattr(msg, 'channel'):
                channel_instruments[msg.channel] = msg.program
            if msg.is_meta:
                if msg.type == 'set_tempo':
                    tempo_changes.append((abs_tick_track, msg.tempo))
                elif msg.type == 'time_signature':
                    numerator = msg.numerator
                    denominator = msg.denominator
    tempo_changes.sort(key=lambda x: x[0])
    def get_time_sec(abs_tick):
        time_sec = 0.0
        for i in range(len(tempo_changes)):
            tick_start, tempo = tempo_changes[i]
            # 修正: 确保只计算当前 tempo 区间内的 tick
            tick_end = tempo_changes[i+1][0] if i + 1 < len(tempo_changes) else abs_tick + 1 # 理论结束点，用于计算边界
            
            # 使用 min(abs_tick, tick_end) 确保计算不会超过当前 abs_tick
            ticks_to_calculate = min(abs_tick, tick_end) - tick_start
            
            if ticks_to_calculate > 0:
                # 累加当前区间的秒数
                time_sec += mido.tick2second(ticks_to_calculate, ticks_per_beat, tempo)
            
            if abs_tick <= tick_end: # 如果当前 abs_tick 已经落在或超过了当前区间，则跳出
                 # 只有当 abs_tick 已经到达或超过下一个 tempo 变化点时，才继续循环
                 if i + 1 < len(tempo_changes) and abs_tick <= tempo_changes[i+1][0]:
                      break
                 elif i + 1 == len(tempo_changes) and abs_tick <= tick_end:
                      break

        return time_sec
    
    active_notes = {}
    for track_idx, track in enumerate(midi.tracks):
        track_name_raw = next((msg.name for msg in track if msg.type == 'track_name'), f"Track {track_idx}")
        track_name_clean = re.sub(r'[^\w\s-]', '', track_name_raw).strip()
        final_track_name = track_name_clean if track_name_clean else f"Track_{track_idx}"
        abs_tick_track = 0
        for msg in track:
            abs_tick_track += msg.time
            time_sec = get_time_sec(abs_tick_track)
            if msg.is_meta:
                continue
            if msg.type in ('note_on', 'note_off') and hasattr(msg, 'note'):
                channel = msg.channel
                instrument_program = channel_instruments.get(channel, 0)
                instrument_name_raw = get_instrument_name(instrument_program)
                if channel == 9:
                    instrument_name_raw = "Drum Kit"
                key = (track_idx, msg.note)
                if msg.type == 'note_on' and msg.velocity > 0:
                    if key not in active_notes:
                        active_notes[key] = {
                            'time_start_sec': time_sec,
                            'time_start_tick': abs_tick_track,
                            'pitch': msg.note,
                            'velocity': msg.velocity,
                            'track': final_track_name,
                            'instrument_raw': instrument_name_raw
                        }
                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    if key in active_notes:
                        note_info = active_notes.pop(key)
                        duration_sec = time_sec - note_info['time_start_sec']
                        duration_tick = abs_tick_track - note_info['time_start_tick']
                        if duration_sec > 0.001:
                            notes_list.append({
                                'time_start_sec': note_info['time_start_sec'],
                                'duration_sec': duration_sec,
                                'pitch': note_info['pitch'],
                                'velocity': note_info['velocity'],
                                'track': note_info['track'],
                                'instrument_raw': note_info['instrument_raw'],
                                'time_start_tick': note_info['time_start_tick'],
                                'duration_tick': duration_tick
                            })
    if not notes_list:
        print("⚠️ 警告：MIDI 文件中未提取到有效音符。")
        return None, 0, 4, 4, 0, ticks_per_beat
    df = pd.DataFrame(notes_list)
    time_offset = df['time_start_sec'].min()
    df['time_start_sec'] = df['time_start_sec'] - time_offset
    
    def apply_instrument_numbering_fixed(group):
        unique_tracks_in_group = sorted(group['track'].unique())
        track_to_number = {track_name: i + 1 for i, track_name in enumerate(unique_tracks_in_group)}
        instrument_name = group['instrument_raw'].iloc[0]
        new_instrument_col_list = []
        for track_name in group['track']:
            number = track_to_number[track_name]
            new_instrument_col_list.append(f"{instrument_name} _ {number}")
        # 返回 Series，索引与组索引对齐
        return pd.Series(new_instrument_col_list, index=group.index) 

    # 核心修正：使用 apply().tolist() 提取值，然后用 pd.Series() 配合原始索引进行赋值
    # 这样避免了新版 Pandas 自动对齐引发的潜在问题
    try:
        # 尝试使用 apply，并显式对齐索引，以兼容新版 Pandas
        temp_series = df.groupby('instrument_raw', group_keys=False).apply(apply_instrument_numbering_fixed)
        df['instrument'] = temp_series.reindex(df.index)
    except ValueError:
        # 如果 apply 仍然失败 (如返回多列)，则使用更古老但兼容性好的 transform 模式模拟 apply 的行为
        # 注意：这里的 apply_instrument_numbering_fixed 必须满足 transform 的要求
        # 由于 apply_instrument_numbering_fixed 并不直接返回聚合值，且其逻辑是按 track 编号，
        # 直接使用 transform 存在困难。我们采用列表拼接方式，确保赋值时是单列。
        
        # 降级方案：收集所有分组的结果 Series 并连接起来
        results = []
        for _, group in df.groupby('instrument_raw'):
             results.append(apply_instrument_numbering_fixed(group))
             
        # 使用 pd.concat 拼接所有 Series，得到一个与 df 长度相同的 Series
        temp_series_concat = pd.concat(results).sort_index()
        df['instrument'] = temp_series_concat
    
    final_bpm = mido.tempo2bpm(tempo_changes[-1][1])
    return df, final_bpm, numerator, denominator, time_offset, ticks_per_beat

def save_output_files(df, base_name, suffix, bpm_data, genre=None, artist=None, title=None, duration_sec=None):
    csv_path = f"{base_name}{suffix}.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n✅ 音符数据已保存到 {csv_path}")
    json_path = f"{base_name}_info.json"
    info_data = dict(bpm_data)
    if genre is not None:
        info_data["genre"] = genre
    if artist is not None:
        info_data["artist"] = artist
    if title is not None:
        info_data["title"] = title
    if duration_sec is not None:
        info_data["duration_sec"] = duration_sec
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(info_data, f, indent=4)
    print(f"✅ 音乐信息 (BPM, 拍号, Ticks, 标签) 已保存到 {json_path}")

def update_manifest_file(manifest_path, new_entries, overwrite=False):
    """
    写入 manifest.json。
    - overwrite=True 时，覆盖为 new_entries（去重后），不保留旧内容。
    - overwrite=False 时，将 new_entries 追加到已有列表并去重。
    """
    if not new_entries:
        print("ℹ️ 没有可写入 manifest.json 的新条目。")
        return
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)

    if overwrite:
        manifest_list = list(dict.fromkeys(new_entries))
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest_list, f, ensure_ascii=False, indent=4)
        print(f"✅ manifest.json 已刷新，写入 {len(manifest_list)} 个条目。")
        return

    manifest_list = []
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    manifest_list = data
                else:
                    print("⚠️ manifest.json 内容不是数组，已重新初始化为空列表。")
        except json.JSONDecodeError:
            print("⚠️ manifest.json 解析失败，将覆盖写入新的列表。")
    added = 0
    for name in new_entries:
        if name not in manifest_list:
            manifest_list.append(name)
            added += 1
    if added > 0:
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest_list, f, ensure_ascii=False, indent=4)
        print(f"✅ manifest.json 已更新，新增 {added} 个条目。")
    else:
        print("ℹ️ manifest.json 已包含所有待添加的条目，无需更新。")

# ----------------------------------------------------
# 主逻辑入口，支持模式选择
# ----------------------------------------------------

INPUT_DIR_SINGLE = "../singlemidi/"
INPUT_DIR_BATCH = "../data/midi/"
OUTPUT_DIR = "../data/processed/"
MANIFEST_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "manifest.json"))
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(INPUT_DIR_SINGLE, exist_ok=True)
os.makedirs(INPUT_DIR_BATCH, exist_ok=True)

print("请选择运行模式：\n1. 单个文件模式（手动输入文件名，兼容原逻辑）\n2. 批量处理data目录下全部midi文件（自动判定genre/classical）\n2s. 批量处理并将文件名追加到 data/manifest.json")
mode = input("请输入 1、2 或 2s: ").strip()

if mode in ('2', '2s'):
    overwrite_manifest = (mode == '2')
    append_manifest = (mode == '2s')
    midi_files = glob.glob(os.path.join(INPUT_DIR_BATCH, "*.mid")) + glob.glob(os.path.join(INPUT_DIR_BATCH, "*.midi"))
    if not midi_files:
        print(f"未在 {INPUT_DIR_BATCH} 找到任何 MIDI 文件，请添加后重试。")
        sys.exit(0)
    processed_names = []
    for midi_path in midi_files:
        midi_filename = os.path.basename(midi_path)
        base_name, _ = os.path.splitext(midi_filename)
        output_base_path = os.path.join(OUTPUT_DIR, base_name)
        name_parts = base_name.split('_')
        genre = name_parts[0] if len(name_parts) > 0 else ""
        artist = name_parts[1] if len(name_parts) > 1 else ""
        title = name_parts[2] if len(name_parts) > 2 else ""
        print(f'\n========== 处理: {midi_filename} ==========')
        df_original, final_bpm, numerator, denominator, time_offset, ticks_per_beat = generate_original_df(midi_path)
        if df_original is None:
            print(f"处理 {midi_filename} 失败，跳过。")
            continue
        total_duration_sec = df_original['time_start_sec'].max() + df_original['duration_sec'].max()
        metrics = compute_music_metrics(df_original, total_duration_sec)
        bpm_data = {
            'bpm': final_bpm,
            'numerator': numerator,
            'denominator': denominator,
            'ticks_per_beat': ticks_per_beat,
            **metrics
        }
        df_original_final = df_original.drop(columns=['instrument_raw'])
        save_output_files(df_original_final, output_base_path, '_notes', bpm_data, genre, artist, title, total_duration_sec)
        is_classical = 'y' if genre.lower() == 'classical' else 'n'
        df_clean = df_original.copy()
        df_clean = df_clean.reset_index(drop=True)
        df_clean['instrument_base'] = df_clean['instrument'].apply(get_base_instrument_name)
        if is_classical == 'y':
            print("[classical模式] 正在进行数据去冗余和配器规范化...")
            def get_normalized_name(row):
                instrument_base = row['instrument_base']
                track_name = row['track']
                cleaned_inst_key = clean_instrument_name(instrument_base)
                family_of_base_inst = get_instrument_family(instrument_base)
                if cleaned_inst_key == 'bassoon':
                    return INSTRUMENT_MAP.get('bassoon')
                instrument_name_from_track = find_keyword_match(track_name, INSTRUMENT_MAP)
                if instrument_name_from_track:
                    return instrument_name_from_track
                normalized_name_from_inst_exact = INSTRUMENT_MAP.get(cleaned_inst_key, None)
                if normalized_name_from_inst_exact:
                    return normalized_name_from_inst_exact
                vocal_name_from_track = find_keyword_match(track_name, VOCAL_MAP)
                if vocal_name_from_track:
                    if family_of_base_inst == 'vocal':
                        return vocal_name_from_track
                vocal_name_from_inst = find_keyword_match(instrument_base, VOCAL_MAP)
                if vocal_name_from_inst:
                    return vocal_name_from_inst
                if instrument_base == "Drum Kit":
                    return "Percussion/Kit"
                family_key = get_instrument_family(instrument_base)
                normalized_name_from_family = INSTRUMENT_MAP.get(family_key, None)
                if normalized_name_from_family:
                    return normalized_name_from_family
                return instrument_base
            df_clean['instrument_normalized'] = df_clean.apply(get_normalized_name, axis=1)
            indices_to_drop = []
            final_part_names = {}
            for normalized_name, group_df in df_clean.groupby('instrument_normalized'):
                unique_parts_raw = sorted(list(set(group_df['instrument'])))
                part_notes = {
                    part: group_df[ (group_df['instrument'] == part).values ]
                    for part in unique_parts_raw
                }
                processed_parts = set()
                part_groups = []
                for i in range(len(unique_parts_raw)):
                    main_part = unique_parts_raw[i]
                    if main_part in processed_parts:
                        continue
                    redundant_group = [main_part]
                    for j in range(i + 1, len(unique_parts_raw)):
                        other_part = unique_parts_raw[j]
                        if other_part in processed_parts:
                            continue
                        similarity = calculate_sequence_similarity(part_notes[main_part], part_notes[other_part])
                        if similarity > 0.99:
                            redundant_group.append(other_part)
                    part_groups.append(redundant_group)
                    for k, part_raw in enumerate(redundant_group):
                        if k > 0:
                            indices_to_drop.extend(part_notes[part_raw].index.tolist())
                        processed_parts.add(part_raw)
                kept_parts = [g[0] for g in part_groups]
                def get_original_number(part_name):
                    match = re.search(r' _ (\d+)$', part_name)
                    return int(match.group(1)) if match else 999
                kept_parts.sort(key=get_original_number)
                for i, part_raw in enumerate(kept_parts):
                    final_name = f"{normalized_name} {i + 1}"
                    if len(kept_parts) == 1 and normalized_name not in ['Strings', 'Brass Section', 'Keyboard', 'Percussion/Kit', 'Choir', 'Voice', 'Guitar']:
                        final_name = normalized_name
                    redundant_group_to_map = next(g for g in part_groups if g[0] == part_raw)
                    for part_to_map in redundant_group_to_map:
                        final_part_names[part_to_map] = final_name
            df_clean['track_new'] = df_clean['instrument'].apply(lambda x: final_part_names.get(x, x))
            df_clean = df_clean.drop(indices_to_drop, errors='ignore').reset_index(drop=True)
            print(f'已删除 {len(indices_to_drop)} 行冗余数据。')
        else:
            print("[非classical模式] 直接映射原始 instrument 到 track_new。")
            df_clean['track_new'] = df_clean['instrument']
        df_clean = df_clean.drop(columns=['instrument_base', 'instrument_raw', 'instrument_normalized'], errors='ignore')
        clean_column_order = [
            'time_start_sec', 'duration_sec', 'pitch', 'velocity', 'track', 'instrument',
            'track_new', 'time_start_tick', 'duration_tick'
        ]
        df_clean = df_clean[clean_column_order]
        save_output_files(df_clean, output_base_path, '_notes_clean', bpm_data, genre, artist, title, total_duration_sec)
        processed_names.append(base_name)
    if overwrite_manifest:
        update_manifest_file(MANIFEST_PATH, processed_names, overwrite=True)
    elif append_manifest:
        update_manifest_file(MANIFEST_PATH, processed_names)
    print('\n所有文件已批量处理完成！')
    sys.exit(0)

# ------------- 单文件（手动）模式：保留原流程 -------------
print(f"请将 MIDI 文件放入 {INPUT_DIR_SINGLE} 文件夹。")
print(f"CSV/JSON 输出将保存到 {OUTPUT_DIR} 文件夹。")
while True:
    try:
        midi_filename = input("请输入需要处理的 MIDI 文件名 (例如: bach_850.mid): ").strip()
        if not midi_filename:
            print("文件名不能为空。请重新输入。")
            continue
        input_midi = os.path.join(INPUT_DIR_SINGLE, midi_filename)
        if not os.path.exists(input_midi):
            print(f"❌ 错误：找不到输入 MIDI 文件: {input_midi}")
            print("请确认文件名输入正确，且文件已放置在 ./midi/ 文件夹中。")
            continue
        base_name, _ = os.path.splitext(midi_filename)
        output_base_path = os.path.join(OUTPUT_DIR, base_name)
        name_parts = base_name.split('_')
        genre = name_parts[0] if len(name_parts) > 0 else ""
        artist = name_parts[1] if len(name_parts) > 1 else ""
        title = name_parts[-1] if len(name_parts) > 0 else ""
        df_original, final_bpm, numerator, denominator, time_offset, ticks_per_beat = generate_original_df(input_midi)
        if df_original is None:
              break
        total_duration_sec = df_original['time_start_sec'].max() + df_original['duration_sec'].max()
        metrics = compute_music_metrics(df_original, total_duration_sec)
        bpm_data = {
            'bpm': final_bpm,
            'numerator': numerator,
            'denominator': denominator,
            'ticks_per_beat': ticks_per_beat,
            **metrics
        }
        df_original_final = df_original.drop(columns=['instrument_raw'])
        save_output_files(df_original_final, output_base_path, '_notes', bpm_data, genre, artist, title, total_duration_sec)
        is_classical = input("\n请问这是古典乐文件吗？(输入 y 进行清理/n 跳过): ").strip().lower()
        df_clean = df_original.copy()
        df_clean = df_clean.reset_index(drop=True)
        df_clean['instrument_base'] = df_clean['instrument'].apply(get_base_instrument_name)
        if is_classical == 'y':
            print("\n[古典乐模式] 正在进行数据去冗余和配器规范化...")
            def get_normalized_name(row):
                instrument_base = row['instrument_base']
                track_name = row['track']
                cleaned_inst_key = clean_instrument_name(instrument_base)
                family_of_base_inst = get_instrument_family(instrument_base)
                if cleaned_inst_key == 'bassoon':
                    return INSTRUMENT_MAP.get('bassoon')
                instrument_name_from_track = find_keyword_match(track_name, INSTRUMENT_MAP)
                if instrument_name_from_track:
                    return instrument_name_from_track
                normalized_name_from_inst_exact = INSTRUMENT_MAP.get(cleaned_inst_key, None)
                if normalized_name_from_inst_exact:
                    return normalized_name_from_inst_exact
                vocal_name_from_track = find_keyword_match(track_name, VOCAL_MAP)
                if vocal_name_from_track:
                    if family_of_base_inst == 'vocal':
                           return vocal_name_from_track
                vocal_name_from_inst = find_keyword_match(instrument_base, VOCAL_MAP)
                if vocal_name_from_inst:
                    return vocal_name_from_inst
                if instrument_base == "Drum Kit":
                    return "Percussion/Kit"
                family_key = get_instrument_family(instrument_base)
                normalized_name_from_family = INSTRUMENT_MAP.get(family_key, None)
                if normalized_name_from_family:
                    return normalized_name_from_family
                return instrument_base
            df_clean['instrument_normalized'] = df_clean.apply(get_normalized_name, axis=1)
            indices_to_drop = []
            final_part_names = {} # {instrument_with_numbering: final_new_name}
            for normalized_name, group_df in df_clean.groupby('instrument_normalized'):
                unique_parts_raw = sorted(list(set(group_df['instrument'])))
                part_notes = {
                    part: group_df[ (group_df['instrument'] == part).values ]
                    for part in unique_parts_raw
                }
                processed_parts = set()
                part_groups = []
                for i in range(len(unique_parts_raw)):
                    main_part = unique_parts_raw[i]
                    if main_part in processed_parts:
                        continue
                    redundant_group = [main_part]
                    for j in range(i + 1, len(unique_parts_raw)):
                        other_part = unique_parts_raw[j]
                        if other_part in processed_parts:
                            continue
                        similarity = calculate_sequence_similarity(part_notes[main_part], part_notes[other_part])
                        if similarity > 0.99:
                            redundant_group.append(other_part)
                    part_groups.append(redundant_group)
                    for k, part_raw in enumerate(redundant_group):
                        if k > 0: # 留下冗余组中的第一个声部 (主声部)
                            indices_to_drop.extend(part_notes[part_raw].index.tolist())
                        processed_parts.add(part_raw)
                kept_parts = [g[0] for g in part_groups]
                def get_original_number(part_name):
                    match = re.search(r' _ (\d+)$', part_name)
                    return int(match.group(1)) if match else 999
                kept_parts.sort(key=get_original_number)
                for i, part_raw in enumerate(kept_parts):
                    final_name = f"{normalized_name} {i + 1}"
                    if len(kept_parts) == 1 and normalized_name not in ['Strings', 'Brass Section', 'Keyboard', 'Percussion/Kit', 'Choir', 'Voice', 'Guitar']:
                        final_name = normalized_name
                    redundant_group_to_map = next(g for g in part_groups if g[0] == part_raw)
                    for part_to_map in redundant_group_to_map:
                        final_part_names[part_to_map] = final_name
            df_clean['track_new'] = df_clean['instrument'].apply(lambda x: final_part_names.get(x, x))
            df_clean = df_clean.drop(indices_to_drop, errors='ignore').reset_index(drop=True)
            print(f"已删除 {len(indices_to_drop)} 行冗余数据。")
        else: # is_classical.lower() == 'n'
            print("\n[非古典乐模式] 直接映射原始 instrument 到 track_new。")
            df_clean['track_new'] = df_clean['instrument']
        df_clean = df_clean.drop(columns=['instrument_base', 'instrument_raw', 'instrument_normalized'], errors='ignore')
        clean_column_order = [
            'time_start_sec', 'duration_sec', 'pitch', 'velocity', 'track', 'instrument',
            'track_new', 'time_start_tick', 'duration_tick'
        ]
        df_clean = df_clean[clean_column_order]
        save_output_files(df_clean, output_base_path, '_notes_clean', bpm_data, genre, artist, title, total_duration_sec)
        break # 成功处理后退出循环
    except KeyboardInterrupt:
        print("\n操作被用户取消。程序退出。")
        sys.exit(0)
    except Exception as e:
        print(f"发生未预期的错误: {e}")
        if not isinstance(e, KeyboardInterrupt):
            import traceback
            traceback.print_exc()
        break