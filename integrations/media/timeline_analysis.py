from __future__ import annotations

from array import array
import math
import sys
import wave
from pathlib import Path
from typing import Any

import cv2


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return -120.0
    ordered = sorted(values)
    index = int(round(max(0.0, min(1.0, q)) * (len(ordered) - 1)))
    return ordered[index]

def _state_windows(active: list[bool], frame_ms: int, duration: float, wanted: bool) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    index = 0
    while index < len(active):
        if active[index] != wanted:
            index += 1
            continue
        start = index
        while index < len(active) and active[index] == wanted:
            index += 1
        end = index
        start_seconds = min(duration, start * frame_ms / 1000.0)
        end_seconds = min(duration, end * frame_ms / 1000.0)
        if end_seconds > start_seconds:
            windows.append({
                "index": len(windows),
                "startSeconds": round(start_seconds, 3),
                "endSeconds": round(end_seconds, 3),
                "durationSeconds": round(end_seconds - start_seconds, 3),
            })
    return windows



def analyze_audio_activity(
    wav_path: Path,
    *,
    frame_ms: int = 30,
    merge_gap_ms: int = 360,
    min_speech_ms: int = 180,
    padding_ms: int = 150,
) -> dict[str, Any]:
    with wave.open(str(wav_path), "rb") as handle:
        sample_rate = handle.getframerate()
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())

    if sample_rate <= 0 or channels != 1 or sample_width != 2:
        return {
            "method": "adaptive-rms",
            "available": False,
            "reason": "expected 16-bit mono PCM WAV",
            "speechWindows": [],
            "silenceWindows": [],
        }

    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        return {
            "method": "adaptive-rms",
            "available": True,
            "frameMs": frame_ms,
            "thresholdDbfs": -44.0,
            "noiseFloorDbfs": -120.0,
            "speechWindows": [],
            "silenceWindows": [],
        }

    frame_samples = max(1, int(sample_rate * frame_ms / 1000.0))
    levels: list[float] = []
    for start in range(0, len(samples), frame_samples):
        chunk = samples[start : start + frame_samples]
        if not chunk:
            continue
        mean_square = sum(float(value) * float(value) for value in chunk) / len(chunk)
        rms = math.sqrt(mean_square)
        dbfs = 20.0 * math.log10(max(rms, 1.0) / 32768.0)
        levels.append(max(-120.0, dbfs))

    duration = len(samples) / float(sample_rate)
    noise_floor = _percentile(levels, 0.20)
    threshold = max(-44.0, min(-28.0, noise_floor + 10.0))
    active = [level >= threshold for level in levels]
    raw_active = active.copy()
    raw_sound_windows = _state_windows(raw_active, frame_ms, duration, True)
    raw_quiet_windows = _state_windows(raw_active, frame_ms, duration, False)

    merge_frames = max(0, int(round(merge_gap_ms / frame_ms)))
    if merge_frames > 0:
        index = 0
        while index < len(active):
            if active[index]:
                index += 1
                continue
            gap_start = index
            while index < len(active) and not active[index]:
                index += 1
            gap_end = index
            if gap_start > 0 and gap_end < len(active) and (gap_end - gap_start) <= merge_frames:
                for gap_index in range(gap_start, gap_end):
                    active[gap_index] = True

    min_frames = max(1, int(math.ceil(min_speech_ms / frame_ms)))
    pad_frames = max(0, int(round(padding_ms / frame_ms)))
    runs: list[tuple[int, int]] = []
    index = 0
    while index < len(active):
        if not active[index]:
            index += 1
            continue
        start = index
        while index < len(active) and active[index]:
            index += 1
        end = index
        if end - start >= min_frames:
            runs.append((max(0, start - pad_frames), min(len(active), end + pad_frames)))

    merged: list[tuple[int, int]] = []
    for start, end in runs:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    duration = len(samples) / float(sample_rate)
    speech_windows: list[dict[str, Any]] = []
    for speech_index, (start_frame, end_frame) in enumerate(merged):
        start_seconds = min(duration, start_frame * frame_ms / 1000.0)
        end_seconds = min(duration, end_frame * frame_ms / 1000.0)
        if end_seconds <= start_seconds:
            continue
        speech_windows.append({
            "index": speech_index,
            "startSeconds": round(start_seconds, 3),
            "endSeconds": round(end_seconds, 3),
            "durationSeconds": round(end_seconds - start_seconds, 3),
        })

    silence_windows: list[dict[str, Any]] = []
    cursor = 0.0
    for item in speech_windows:
        start_seconds = float(item["startSeconds"])
        if start_seconds > cursor + 0.001:
            silence_windows.append({
                "startSeconds": round(cursor, 3),
                "endSeconds": round(start_seconds, 3),
                "durationSeconds": round(start_seconds - cursor, 3),
            })
        cursor = max(cursor, float(item["endSeconds"]))
    if duration > cursor + 0.001:
        silence_windows.append({
            "startSeconds": round(cursor, 3),
            "endSeconds": round(duration, 3),
            "durationSeconds": round(duration - cursor, 3),
        })

    return {
        "method": "adaptive-rms",
        "available": True,
        "frameMs": frame_ms,
        "analysisResolutionMs": frame_ms,
        "activityKind": "acoustic-energy",
        "thresholdDbfs": round(threshold, 3),
        "noiseFloorDbfs": round(noise_floor, 3),
        "mergeGapMs": merge_gap_ms,
        "minSpeechMs": min_speech_ms,
        "paddingMs": padding_ms,
        "rawSoundWindows": raw_sound_windows,
        "rawQuietWindows": raw_quiet_windows,
        "speechWindows": speech_windows,
        "silenceWindows": silence_windows,
    }


def build_asr_specs(
    duration: float,
    max_segment_seconds: float,
    activity: dict[str, Any] | None,
    alignment_mode: str,
) -> tuple[list[tuple[int, float, float, list[int]]], str]:
    max_segment_seconds = max(1.0, max_segment_seconds)
    speech_windows = [] if not activity else activity.get("speechWindows", [])
    specs: list[tuple[int, float, float, list[int]]] = []

    if alignment_mode == "speech-aware" and speech_windows:
        grouped: list[tuple[float, float, list[int]]] = []
        max_join_gap_seconds = 0.75
        for speech_window in speech_windows:
            window_index = int(speech_window.get("index", 0))
            start = max(0.0, float(speech_window["startSeconds"]))
            end = min(duration, float(speech_window["endSeconds"]))
            if end <= start:
                continue
            if grouped:
                previous_start, previous_end, previous_indices = grouped[-1]
                gap = start - previous_end
                if gap <= max_join_gap_seconds and end - previous_start <= max_segment_seconds:
                    grouped[-1] = (previous_start, end, [*previous_indices, window_index])
                    continue
            grouped.append((start, end, [window_index]))

        index = 0
        for group_start, group_end, window_indices in grouped:
            cursor = group_start
            while cursor < group_end - 0.001:
                end = min(group_end, cursor + max_segment_seconds)
                specs.append((index, cursor, end, window_indices))
                index += 1
                cursor = end
        return specs, "speech-aware-group"

    segment_count = max(1, int(math.ceil(duration / max_segment_seconds)))
    for index in range(segment_count):
        start = index * max_segment_seconds
        end = min(duration, start + max_segment_seconds)
        if end > start:
            specs.append((index, start, end, []))
    return specs, "fixed-window"


def _read_frame(capture: Any, timestamp: float) -> Any | None:
    capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
    ok, frame = capture.read()
    return frame if ok and frame is not None else None


def extract_visual_keyframes(
    source: Path,
    output_dir: Path,
    duration: float,
    *,
    enabled: bool,
    jpeg_quality: int,
    sample_interval: float = 0.75,
    max_keyframes: int = 18,
    min_gap_seconds: float = 0.70,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not enabled or duration <= 0.0:
        return [], {"enabled": enabled, "method": "content-change", "sampleIntervalSeconds": sample_interval}

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        capture.release()
        return [], {"enabled": True, "method": "content-change", "sampleIntervalSeconds": sample_interval, "available": False}

    effective_interval = max(sample_interval, duration / 240.0)
    samples: list[tuple[float, Any, float]] = []
    previous_gray = None
    timestamp = 0.0
    while timestamp < duration:
        frame = _read_frame(capture, timestamp)
        if frame is not None:
            width = frame.shape[1]
            if width > 320:
                scale = 320.0 / width
                frame_small = cv2.resize(frame, (320, max(1, int(frame.shape[0] * scale))))
            else:
                frame_small = frame
            gray = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)
            if previous_gray is None:
                score = 1.0
            else:
                score = float(cv2.absdiff(gray, previous_gray).mean() / 255.0)
            samples.append((timestamp, frame, score))
            previous_gray = gray
        timestamp += effective_interval
    capture.release()

    if not samples:
        return [], {"enabled": True, "method": "content-change", "sampleIntervalSeconds": round(effective_interval, 3), "available": False}

    change_scores = [score for _, _, score in samples[1:]]
    adaptive = _percentile(change_scores, 0.70) if change_scores else 0.0
    threshold = max(0.012, min(0.10, adaptive * 0.85 if adaptive > 0 else 0.012))

    selected: list[tuple[float, Any, float]] = [samples[0]]
    candidates = sorted((item for item in samples[1:] if item[2] >= threshold), key=lambda item: item[2], reverse=True)
    for candidate in candidates:
        if len(selected) >= max_keyframes:
            break
        if all(abs(candidate[0] - chosen[0]) >= min_gap_seconds for chosen in selected):
            selected.append(candidate)
    selected.sort(key=lambda item: item[0])

    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for index, (timestamp, frame, score) in enumerate(selected):
        output = output_dir / f"keyframe_{index:03d}_{timestamp:08.3f}.jpg"
        if not cv2.imwrite(str(output), frame, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]):
            continue
        records.append({
            "index": len(records),
            "timestampSeconds": round(timestamp, 3),
            "path": str(output.resolve()),
            "changeScore": round(score, 6),
            "kind": "visual-change",
        })

    return records, {
        "enabled": True,
        "available": True,
        "method": "content-change",
        "sampleIntervalSeconds": round(effective_interval, 3),
        "changeThreshold": round(threshold, 6),
        "sampleCount": len(samples),
        "keyframeCount": len(records),
        "note": "These are visual content-change review keyframes, not codec/GOP keyframes.",
    }


def nearest_record_indices(records: list[dict[str, Any]], start: float, end: float) -> list[int]:
    if not records:
        return []
    inside = [int(item["index"]) for item in records if start <= float(item["timestampSeconds"]) <= end]
    if inside:
        return inside
    middle = (start + end) * 0.5
    nearest = min(records, key=lambda item: abs(float(item["timestampSeconds"]) - middle))
    return [int(nearest["index"])]
