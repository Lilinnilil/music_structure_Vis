# -*- coding: utf-8 -*-
"""
View C 数据生成（melodic / macro）
- 直接使用 data/processed/*_notes_clean.csv（不依赖 MIDI 解析），速度更快。
- 偏好长段，阈值较宽松，允许 A-B-C 串联以便前端同色链。
"""

import json
import os
import glob
from types import SimpleNamespace

import numpy as np
import pandas as pd

# NumPy 兼容性：旧版代码可能引用 np.int
if not hasattr(np, "int"):
    np.int = int  # type: ignore[attr-defined]

# 路径（基于脚本所在目录）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'data', 'processed'))
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)


def is_percussion_name(name: str) -> bool:
    """粗略判断打击乐/鼓组。"""
    if not name:
        return False
    t = name.lower()
    keywords = ['drum', 'percussion', 'kit', 'cymbal', 'snare', 'tom',
                'timpani', 'woodblock', 'taiko', 'conga', 'bongo']
    return any(k in t for k in keywords)


def load_notes_csv(base_name: str) -> pd.DataFrame:
    """读取 *_notes_clean.csv 并补充 end 列。"""
    csv_path = os.path.join(OUTPUT_DIR, f"{base_name}_notes_clean.csv")
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"notes_clean.csv not found: {csv_path}")
    df = pd.read_csv(csv_path)
    if 'time_end_sec' not in df.columns:
        df['time_end_sec'] = df['time_start_sec'] + df['duration_sec']
    return df


def build_instruments(df: pd.DataFrame):
    """将 DataFrame 转成简易 instrument 列表，兼容原有逻辑。"""
    instruments = []
    for inst_name, g in df.groupby('instrument'):
        is_drum = is_percussion_name(inst_name)
        notes = []
        g_sorted = g.sort_values('time_start_sec')
        for row in g_sorted.itertuples():
            notes.append(SimpleNamespace(start=row.time_start_sec,
                                         end=row.time_end_sec,
                                         pitch=int(row.pitch)))
        instruments.append(SimpleNamespace(name=inst_name, is_drum=is_drum, notes=notes))
    return instruments


def build_chroma_from_notes(df: pd.DataFrame, fs: int = 5):
    """依据音符构建简易 chroma（12 x T），非鼓轨累加。"""
    non_drum = df[~df['instrument'].apply(is_percussion_name)]
    if non_drum.empty:
        return np.zeros((12, 1))

    total_dur = non_drum['time_end_sec'].max()
    frames = max(1, int(np.ceil(total_dur * fs)))
    chroma = np.zeros((12, frames))

    for row in non_drum.itertuples():
        pc = int(row.pitch) % 12
        start_idx = int(np.floor(row.time_start_sec * fs))
        end_idx = int(np.ceil(row.time_end_sec * fs))
        start_idx = max(0, start_idx)
        end_idx = min(frames, max(start_idx + 1, end_idx))
        chroma[pc, start_idx:end_idx] += 1.0

    return chroma


def find_melodic_patterns(df_notes: pd.DataFrame):
    """
    微观模式：基于音程序列的移调不变匹配（偏好长段，阈值宽松）。
    """
    MIN_NOTE_COUNT = 5
    MIN_DURATION = 2.5
    RHYTHM_TOLERANCE = 0.65
    PRIORITY_DURATION_EXP = 1.25

    full_sequence = []
    meta_map = []

    instruments = build_instruments(df_notes)
    for track_idx, instrument in enumerate(instruments):
        if instrument.is_drum:
            continue
        sorted_notes = sorted(instrument.notes, key=lambda x: x.start)
        if len(sorted_notes) < MIN_NOTE_COUNT:
            continue
        for i in range(len(sorted_notes) - 1):
            n1 = sorted_notes[i]
            n2 = sorted_notes[i + 1]
            interval = n2.pitch - n1.pitch
            # 乐句断句：3.5s 内视为同一句
            if n2.start - n1.end < 3.5:
                full_sequence.append(interval)
                meta_map.append({
                    "time": n1.start,
                    "duration": n2.end - n1.start,
                    "track": track_idx,
                    "pitch": n1.pitch
                })
            else:
                full_sequence.append(999)  # 中断符
                meta_map.append({
                    "time": n1.start,
                    "duration": 0,
                    "track": track_idx,
                    "pitch": 0
                })

    # 终止符防越界
    for _ in range(5):
        full_sequence.append(888)
        meta_map.append({"time": 0, "duration": 0, "track": -1, "pitch": 0})

    def encode_seq(seq):
        return "".join([chr(x + 200) for x in seq])

    str_seq = encode_seq(full_sequence)
    fingerprint_map = {}
    window_size = MIN_NOTE_COUNT
    break_char1 = chr(999 + 200)
    break_char2 = chr(888 + 200)

    # 指纹索引
    for i in range(0, len(str_seq) - window_size):
        sub = str_seq[i:i + window_size]
        if break_char1 in sub or break_char2 in sub:
            continue
        intervals = [ord(c) - 200 for c in sub]
        if intervals.count(0) / len(intervals) > 0.5:
            continue
        cumulative = [0]
        for val in intervals:
            cumulative.append(cumulative[-1] + val)
        if (max(cumulative) - min(cumulative)) < 3 or len(set(cumulative)) < 3:
            continue
        fingerprint_map.setdefault(sub, []).append(i)

    unique_arcs = []
    for sub, indices in fingerprint_map.items():
        if len(indices) < 2:
            continue
        for k in range(len(indices) - 1):
            idx_a = indices[k]
            idx_b = indices[k + 1]

            # 贪婪扩展
            match_len = window_size
            while (idx_a + match_len < len(str_seq)) and \
                  (idx_b + match_len < len(str_seq)) and \
                  str_seq[idx_a + match_len] == str_seq[idx_b + match_len]:
                if str_seq[idx_a + match_len] == chr(888 + 200):
                    break
                match_len += 1

            segment_pitches = [meta_map[idx_a + m]['pitch'] for m in range(match_len) if meta_map[idx_a + m]['pitch'] > 0]
            if not segment_pitches:
                continue
            # 音高变化要求：≥3 个不同音高，跨度 ≥3 半音
            if len(set(segment_pitches)) < 3 or (max(segment_pitches) - min(segment_pitches) < 3):
                continue

            check_len = min(match_len, 10)
            deltas_a, deltas_b = [], []
            for m in range(check_len - 1):
                deltas_a.append(meta_map[idx_a + m + 1]['time'] - meta_map[idx_a + m]['time'])
                deltas_b.append(meta_map[idx_b + m + 1]['time'] - meta_map[idx_b + m]['time'])
            if len(deltas_a) < 2:
                continue
            ratios = [db / da if da > 0.05 else 1.0 for da, db in zip(deltas_a, deltas_b)]
            cv = 0 if np.mean(ratios) == 0 else np.std(ratios) / np.mean(ratios)
            if cv > RHYTHM_TOLERANCE:
                continue

            start_time_a = meta_map[idx_a]['time']
            end_time_a = meta_map[idx_a + match_len - 1]['time']
            duration = end_time_a - start_time_a
            start_time_b = meta_map[idx_b]['time']

            if duration < MIN_DURATION:
                continue
            if abs(start_time_a - start_time_b) < 1.0:
                continue

            pitches_b = [
                meta_map[idx_b + m]['pitch']
                for m in range(match_len)
                if meta_map[idx_b + m]['pitch'] > 0
            ]
            if not pitches_b:
                continue

            unique_arcs.append({
                "source_start": min(start_time_a, start_time_b),
                "target_start": max(start_time_a, start_time_b),
                "source_min": int(min(segment_pitches)) if start_time_a < start_time_b else int(min(pitches_b)),
                "source_max": int(max(segment_pitches)) if start_time_a < start_time_b else int(max(pitches_b)),
                "target_min": int(min(pitches_b)) if start_time_a < start_time_b else int(min(segment_pitches)),
                "target_max": int(max(pitches_b)) if start_time_a < start_time_b else int(max(segment_pitches)),
                "duration": round(duration, 2),
                "span": round(abs(start_time_b - start_time_a), 2)
            })

    # 去重（长段优先覆盖）
    unique_arcs.sort(key=lambda x: x['duration'], reverse=True)
    final_arcs = []
    for candidate in unique_arcs:
        is_redundant = False
        for existing in final_arcs:
            buf = 0.5
            source_covered = (
                existing['source_start'] - buf <= candidate['source_start'] <= existing['source_start'] + existing['duration'] + buf
            ) and (
                existing['source_start'] - buf <= candidate['source_start'] + candidate['duration'] <= existing['source_start'] + existing['duration'] + buf
            )
            target_covered = (
                existing['target_start'] - buf <= candidate['target_start'] <= existing['target_start'] + existing['duration'] + buf
            ) and (
                existing['target_start'] - buf <= candidate['target_start'] + candidate['duration'] <= existing['target_start'] + existing['duration'] + buf
            )
            if source_covered and target_covered:
                is_redundant = True
                break
        if not is_redundant:
            final_arcs.append(candidate)

    def melodic_priority_score(arc):
        return (arc['duration'] ** PRIORITY_DURATION_EXP) * np.sqrt(max(arc['span'], 0.001))

    final_arcs.sort(key=lambda x: melodic_priority_score(x), reverse=True)
    return final_arcs[:800]


def find_macro_patterns(df_notes: pd.DataFrame):
    """
    宏观模式：仅输出高相似反复 (macro_repeat)
    - 时长下限较长，阈值高（移调/配器变化但高度相似）
    - 内部去重：两个连线的源/目标都相互重叠超过 70% 时合并，duration 取并集
    """
    print(">>> Calculating Macro Texture Repetition (macro_repeat only)...")

    fs = 5
    chroma = build_chroma_from_notes(df_notes, fs=fs)
    if chroma.shape[1] == 0:
        return []
    total_dur = float(df_notes['time_end_sec'].max() or 0)

    norms = np.linalg.norm(chroma, axis=0)
    norms[norms < 1e-6] = 1
    chroma = chroma / norms

    features = chroma.T
    SSM = np.dot(features, features.T)

    patterns = []
    T = chroma.shape[1]

    def validate_similarity(src_start, src_end, tgt_start, tgt_end):
        non_drum = df_notes[~df_notes['instrument'].apply(is_percussion_name)]
        seg1 = non_drum[(non_drum['time_start_sec'] < src_end) & (non_drum['time_end_sec'] > src_start)]
        seg2 = non_drum[(non_drum['time_start_sec'] < tgt_end) & (non_drum['time_end_sec'] > tgt_start)]
        if seg1.empty or seg2.empty:
            return False
        p1 = seg1['pitch'].mean()
        p2 = seg2['pitch'].mean()
        if abs(p1 - p2) > 6:
            return False
        d1 = len(seg1) / (src_end - src_start + 0.001)
        d2 = len(seg2) / (tgt_end - tgt_start + 0.001)
        if d1 > 0 and d2 > 0:
            ratio = d1 / d2
            if ratio > 1.7 or ratio < 0.6:
                return False
        return True

    min_len_sec = 6.0
    thresholds = [0.90, 0.85]
    min_len_frames = int(min_len_sec * fs)
    min_lag_sec = 2.0
    min_lag_frames = int(min_lag_sec * fs)
    max_lag_frames = int(T * 0.85)
    smooth_win_size = int(1.2 * fs)
    if smooth_win_size < 1:
        smooth_win_size = 1
    smooth_kernel = np.ones(smooth_win_size) / smooth_win_size

    for thresh in thresholds:
        if len(patterns) > 400:
            break
        for lag in range(min_lag_frames, max_lag_frames):
            diag = np.diagonal(SSM, offset=lag)
            if len(diag) < min_len_frames:
                continue

            diag_smoothed = np.convolve(diag, smooth_kernel, mode='valid')
            is_match = diag_smoothed > thresh

            diffs = np.diff(is_match.astype(int))
            starts = np.where(diffs == 1)[0] + 1
            ends = np.where(diffs == -1)[0] + 1
            if is_match[0]:
                starts = np.r_[0, starts]
            if is_match[-1]:
                ends = np.r_[ends, len(is_match)]

            for s, e in zip(starts, ends):
                real_s = s
                real_e = e + smooth_win_size - 1
                length = real_e - real_s
                if length < min_len_frames:
                    continue

                src_sec = real_s / fs
                tgt_sec = (real_s + lag) / fs
                dur_sec = length / fs

                if not validate_similarity(src_sec, src_sec + dur_sec, tgt_sec, tgt_sec + dur_sec):
                    continue

                conf_val = float(np.mean(diag[real_s:real_e]))
                if conf_val < (thresh + 0.05):
                    continue

                patterns.append({
                    "source_start": round(src_sec, 2),
                    "target_start": round(tgt_sec, 2),
                    "duration": round(dur_sec, 2),
                    "span": round(tgt_sec - src_sec, 2),
                    "type": "macro_skeleton",
                    "confidence": conf_val
                })

    # 先移除被更长段完全覆盖的短段（同源同目标均被覆盖）
    def drop_contained(arr):
        arr_sorted = sorted(arr, key=lambda x: x['duration'], reverse=True)
        kept = []
        buf = 0.1
        for p in arr_sorted:
            s1, e1 = p['source_start'], p['source_start'] + p['duration']
            t1, te1 = p['target_start'], p['target_start'] + p['duration']
            contained = False
            for k in kept:
                s2, e2 = k['source_start'], k['source_start'] + k['duration']
                t2, te2 = k['target_start'], k['target_start'] + k['duration']
                if (s2 - buf <= s1 and e1 <= e2 + buf) and (t2 - buf <= t1 and te1 <= te2 + buf):
                    contained = True
                    break
            if not contained:
                kept.append(p)
        return kept

    patterns = drop_contained(patterns)

    # 排序与分桶（按 span 近似分组，每桶保留 2 条）
    def score(p):
        return (p['duration'] ** 1.25) * np.sqrt(p['span']) * p.get('confidence', 1.0)

    patterns.sort(key=score, reverse=True)
    buckets = {}
    for p in patterns:
        key = round(p['span'], 1)
        buckets.setdefault(key, []).append(p)
    trimmed = []
    for bucket in buckets.values():
        bucket.sort(key=score, reverse=True)
        trimmed.extend(bucket[:2])

    # 额外聚类合并：源段重叠>0.6且时长接近，目标重叠>0.3 时合并并集；否则保持
    trimmed.sort(key=score, reverse=True)
    clusters = []
    def duration_close(d1, d2, tol=0.12):
        return abs(d1 - d2) / max(d1, d2, 1e-6) <= tol
    for p in trimmed:
        s1, e1 = p['source_start'], p['source_start'] + p['duration']
        t1, te1 = p['target_start'], p['target_start'] + p['duration']
        placed = False
        for c in clusters:
            s2, e2 = c['source_start'], c['source_start'] + c['duration']
            t2, te2 = c['target_start'], c['target_start'] + c['duration']
            ov_s = min(e1, e2) - max(s1, s2)
            ov_t = min(te1, te2) - max(t1, t2)
            if ov_s > 0 and ov_t > 0:
                ra_s = min(ov_s / max(e1 - s1, 1e-6), ov_s / max(e2 - s2, 1e-6))
                ra_t = min(ov_t / max(te1 - t1, 1e-6), ov_t / max(te2 - t2, 1e-6))
                if duration_close(p['duration'], c['duration'], tol=0.12) and ra_s > 0.6 and ra_t > 0.3:
                    # 合并并集
                    new_s_start = min(s1, s2)
                    new_s_end = max(e1, e2)
                    new_t_start = min(t1, t2)
                    new_t_end = max(te1, te2)
                    c['source_start'] = round(new_s_start, 2)
                    c['target_start'] = round(new_t_start, 2)
                    c['duration'] = round(max(new_s_end - new_s_start, new_t_end - new_t_start), 2)
                    c['span'] = round(c['target_start'] - c['source_start'], 2)
                    c['confidence'] = max(c.get('confidence', 0), p.get('confidence', 0))
                    placed = True
                    break
        if not placed:
            clusters.append(dict(p))

    # 去重：源/目标双重高重叠且时长接近则丢弃低分
    clusters.sort(key=score, reverse=True)
    dedup = []
    for p in clusters:
        s1, e1 = p['source_start'], p['source_start'] + p['duration']
        t1, te1 = p['target_start'], p['target_start'] + p['duration']
        d1 = p['duration']
        duplicate = False
        for kept in dedup:
            s2, e2 = kept['source_start'], kept['source_start'] + kept['duration']
            t2, te2 = kept['target_start'], kept['target_start'] + kept['duration']
            d2 = kept['duration']
            ra_s = 0.0
            if min(e1, e2) > max(s1, s2):
                ov = min(e1, e2) - max(s1, s2)
                ra_s = min(ov / max(e1 - s1, 1e-6), ov / max(e2 - s2, 1e-6))
            ra_t = 0.0
            if min(te1, te2) > max(t1, t2):
                ov = min(te1, te2) - max(t1, t2)
                ra_t = min(ov / max(te1 - t1, 1e-6), ov / max(te2 - t2, 1e-6))
            if abs(d1 - d2) / max(d1, d2, 1e-6) <= 0.12 and (ra_s > 0.75 and ra_t > 0.75):
                duplicate = True
                break
        if not duplicate:
            dedup.append(p)

    # 额外相邻合并：源/目标几乎连续且时长接近时，合并为更长弧
    dedup.sort(key=lambda x: x['source_start'])
    merged_contig = []
    tol_gap = 0.5  # 允许的间隙/重叠（秒）
    tol_dur = 0.12
    cur = None
    for p in dedup:
        if cur is None:
            cur = dict(p)
            continue
        src_end_cur = cur['source_start'] + cur['duration']
        tgt_end_cur = cur['target_start'] + cur['duration']
        src_gap = p['source_start'] - src_end_cur
        tgt_gap = p['target_start'] - tgt_end_cur
        dur_close = abs(p['duration'] - cur['duration']) / max(p['duration'], cur['duration'], 1e-6) <= tol_dur
        if dur_close and -0.3 <= src_gap <= tol_gap and -0.3 <= tgt_gap <= tol_gap:
            new_src_start = cur['source_start']
            new_src_end = max(src_end_cur, p['source_start'] + p['duration'])
            new_tgt_start = min(cur['target_start'], p['target_start'])
            new_tgt_end = max(tgt_end_cur, p['target_start'] + p['duration'])
            cur['source_start'] = round(new_src_start, 2)
            cur['target_start'] = round(new_tgt_start, 2)
            cur['duration'] = round(max(new_src_end - new_src_start, new_tgt_end - new_tgt_start), 2)
            cur['span'] = round(cur['target_start'] - cur['source_start'], 2)
            cur['confidence'] = max(cur.get('confidence', 0), p.get('confidence', 0))
        else:
            merged_contig.append(cur)
            cur = dict(p)
    if cur is not None:
        merged_contig.append(cur)

    if total_dur > 0:
        merged_contig = [a for a in merged_contig if not (a['duration'] >= 0.9 * total_dur)]

    merged_contig.sort(key=score, reverse=True)
    merged_contig = merged_contig[:32]
    print(f"Macro Mode (skeleton only): {len(merged_contig)} arcs")
    return merged_contig


def main():
    info_files = glob.glob(os.path.join(OUTPUT_DIR, '*_info.json'))
    if not info_files:
        print(f"[Error] No _info.json files found in {OUTPUT_DIR}. Please run midi_to_csv_clean.py first.")
        return

    print(f"[Info] Found {len(info_files)} processed items. Generating View C data from notes_clean.csv ...")

    skip_list = {"Minimalism_TerryRiley_InC"}

    for info_path in info_files:
        try:
            filename = os.path.basename(info_path)
            base_name = filename.replace('_info.json', '')
            if base_name in skip_list:
                print(f"[Skip] {base_name} (in skip list)")
                continue
            print(f"[Processing] {base_name} (Source: notes_clean.csv)")

            df_notes = load_notes_csv(base_name)

            arcs_melodic = find_melodic_patterns(df_notes)
            with open(os.path.join(OUTPUT_DIR, f"{base_name}_arcs_melodic.json"), 'w') as f:
                json.dump(arcs_melodic, f)

            arcs_macro = find_macro_patterns(df_notes)
            with open(os.path.join(OUTPUT_DIR, f"{base_name}_arcs_macro.json"), 'w') as f:
                json.dump(arcs_macro, f)

            print(" [Done]")
        except Exception as e:
            print(f" [Failed]: {e}")

    print("\n[Success] All tasks completed!")


if __name__ == "__main__":
    main()

