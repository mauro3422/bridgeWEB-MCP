from __future__ import annotations

from array import array
import math
import sys
import wave
from pathlib import Path
from typing import Any

import cv2
import numpy as np


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
                "index": len(silence_windows),
                "startSeconds": round(cursor, 3),
                "endSeconds": round(start_seconds, 3),
                "durationSeconds": round(start_seconds - cursor, 3),
            })
        cursor = max(cursor, float(item["endSeconds"]))
    if duration > cursor + 0.001:
        silence_windows.append({
            "index": len(silence_windows),
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
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000.0)
    ok, frame = capture.read()
    return frame if ok and frame is not None else None


def _visual_gray(frame: Any, max_width: int = 320) -> Any:
    width = int(frame.shape[1])
    if width > max_width:
        scale = max_width / float(width)
        frame = cv2.resize(frame, (max_width, max(1, int(frame.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(gray, (5, 5), 0)


def _direction_from_vector(dx: float, dy: float, deadzone: float = 0.30) -> str:
    magnitude = math.hypot(dx, dy)
    if magnitude < deadzone:
        return "still"
    horizontal = "right" if dx > 0 else "left"
    vertical = "down" if dy > 0 else "up"
    ax = abs(dx)
    ay = abs(dy)
    if ax > ay * 1.7:
        return horizontal
    if ay > ax * 1.7:
        return vertical
    return f"{vertical}-{horizontal}"


def _nearest_visual_sample(samples: list[dict[str, Any]], timestamp: float) -> dict[str, Any] | None:
    if not samples:
        return None
    return min(samples, key=lambda item: abs(float(item["timestampSeconds"]) - timestamp))


def _build_motion_windows(samples: list[dict[str, Any]], sample_interval: float) -> list[dict[str, Any]]:
    active_samples = [item for item in samples[1:] if bool(item.get("motionActive"))]
    if not active_samples:
        return []

    grouped: list[list[dict[str, Any]]] = []
    max_gap = max(0.45, sample_interval * 3.5)
    for item in active_samples:
        if grouped and float(item.get("fromSeconds", item["timestampSeconds"])) - float(grouped[-1][-1]["timestampSeconds"]) <= max_gap:
            grouped[-1].append(item)
        else:
            grouped.append([item])

    windows: list[dict[str, Any]] = []
    for group in grouped:
        start = max(0.0, float(group[0].get("fromSeconds", group[0]["timestampSeconds"])))
        end = float(group[-1]["timestampSeconds"])
        if end <= start:
            continue
        peak = max(group, key=lambda item: float(item.get("motionScore", 0.0)))
        dx_values = [float(item.get("translationX", 0.0)) for item in group]
        dy_values = [float(item.get("translationY", 0.0)) for item in group]
        vx_values = [float(item.get("velocityX", 0.0)) for item in group]
        vy_values = [float(item.get("velocityY", 0.0)) for item in group]
        responses = [max(0.0, min(1.0, float(item.get("translationResponse", 0.0)))) for item in group]
        dx = float(np.median(np.asarray(dx_values, dtype=np.float32))) if dx_values else 0.0
        dy = float(np.median(np.asarray(dy_values, dtype=np.float32))) if dy_values else 0.0
        vx = float(np.median(np.asarray(vx_values, dtype=np.float32))) if vx_values else 0.0
        vy = float(np.median(np.asarray(vy_values, dtype=np.float32))) if vy_values else 0.0
        confidence = float(np.median(np.asarray(responses, dtype=np.float32))) if responses else 0.0
        peak_score = float(peak.get("motionScore", 0.0))
        peak_magnitude = float(peak.get("translationMagnitude", 0.0))
        aggregate_magnitude = math.hypot(dx, dy)
        if peak_score < 1.0 or peak_magnitude < 1.5:
            continue
        if aggregate_magnitude < 0.8 and peak_magnitude < 4.0:
            continue
        direction_dx = dx if aggregate_magnitude >= 0.8 else float(peak.get("translationX", 0.0))
        direction_dy = dy if aggregate_magnitude >= 0.8 else float(peak.get("translationY", 0.0))
        apparent_direction = _direction_from_vector(direction_dx, direction_dy)
        inverse_hint = _direction_from_vector(-direction_dx, -direction_dy)
        windows.append({
            "index": len(windows),
            "kind": "view-motion",
            "startSeconds": round(start, 3),
            "endSeconds": round(end, 3),
            "durationSeconds": round(end - start, 3),
            "peakSeconds": round(float(peak["timestampSeconds"]), 3),
            "peakSampleIndex": int(peak["index"]),
            "peakMotionScore": round(peak_score, 6),
            "peakTranslationMagnitudeAnalysisPixels": round(peak_magnitude, 4),
            "sampleIndices": [int(item["index"]) for item in group],
            "apparentTranslation": {
                "xAnalysisPixels": round(dx, 4),
                "yAnalysisPixels": round(dy, 4),
                "magnitudeAnalysisPixels": round(math.hypot(dx, dy), 4),
                "velocityXAnalysisPixelsPerSecond": round(vx, 3),
                "velocityYAnalysisPixelsPerSecond": round(vy, 3),
                "direction": apparent_direction,
                "confidence": round(confidence, 4),
            },
            "inverseViewDirectionHint": inverse_hint,
            "directionNote": "inverseViewDirectionHint is the inverse of dominant apparent image translation; it is a 2D viewport/camera-pan hint, not a recovered 3D camera transform.",
        })
    return windows


def extract_visual_keyframes(
    source: Path,
    output_dir: Path,
    duration: float,
    *,
    enabled: bool,
    jpeg_quality: int,
    analysis_fps: float = 10.0,
    max_keyframes: int = 24,
    min_gap_seconds: float = 0.35,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not enabled or duration <= 0.0:
        return [], {"enabled": enabled, "method": "adaptive-content-motion", "available": False, "events": [], "motionWindows": [], "samples": []}

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        capture.release()
        return [], {"enabled": True, "method": "adaptive-content-motion", "available": False, "events": [], "motionWindows": [], "samples": []}

    fps = max(0.0, float(capture.get(cv2.CAP_PROP_FPS) or 0.0))
    requested_analysis_fps = max(1.0, min(float(analysis_fps), 20.0))
    sample_budget_fps = 6000.0 / duration if duration > 0 else requested_analysis_fps
    effective_analysis_fps = max(1.0, min(requested_analysis_fps, sample_budget_fps))
    stride = max(1, int(math.ceil(fps / effective_analysis_fps))) if fps > 0.0 else 1
    sample_interval = stride / fps if fps > 0.0 else 1.0 / effective_analysis_fps

    samples: list[dict[str, Any]] = []
    previous_gray = None
    previous_timestamp = 0.0
    decoded_frames = 0
    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok or frame is None:
            break
        decoded_frames += 1
        should_sample = frame_index == 0 or frame_index % stride == 0
        if should_sample:
            timestamp = frame_index / fps if fps > 0.0 else max(0.0, float(capture.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0)
            gray = _visual_gray(frame)
            if previous_gray is None:
                change_score = 0.0
                shift_x = 0.0
                shift_y = 0.0
                response = 1.0
                delta_seconds = 0.0
            else:
                change_score = float(cv2.absdiff(gray, previous_gray).mean() / 255.0)
                delta_seconds = max(0.001, timestamp - previous_timestamp)
                try:
                    shift, raw_response = cv2.phaseCorrelate(previous_gray.astype(np.float32), gray.astype(np.float32))
                    shift_x = float(shift[0])
                    shift_y = float(shift[1])
                    response = max(0.0, min(1.0, float(raw_response)))
                except Exception:
                    shift_x = 0.0
                    shift_y = 0.0
                    response = 0.0
            magnitude = math.hypot(shift_x, shift_y)
            velocity_x = shift_x / delta_seconds if delta_seconds > 0.0 else 0.0
            velocity_y = shift_y / delta_seconds if delta_seconds > 0.0 else 0.0
            samples.append({
                "index": len(samples),
                "frameIndex": frame_index,
                "fromSeconds": round(previous_timestamp if previous_gray is not None else timestamp, 3),
                "timestampSeconds": round(timestamp, 3),
                "changeScore": round(change_score, 6),
                "translationX": round(shift_x, 5),
                "translationY": round(shift_y, 5),
                "translationMagnitude": round(magnitude, 5),
                "translationResponse": round(response, 5),
                "velocityX": round(velocity_x, 4),
                "velocityY": round(velocity_y, 4),
            })
            previous_gray = gray
            previous_timestamp = timestamp
        frame_index += 1
    capture.release()

    if not samples:
        return [], {
            "enabled": True,
            "method": "adaptive-content-motion",
            "available": False,
            "analysisFps": round(effective_analysis_fps, 3),
            "analysisResolutionSeconds": round(sample_interval, 4),
            "events": [],
            "motionWindows": [],
            "samples": [],
        }

    change_scores = [float(item["changeScore"]) for item in samples[1:]]
    p70_change = max(0.0, _percentile(change_scores, 0.70)) if change_scores else 0.0
    p90_change = max(0.0, _percentile(change_scores, 0.90)) if change_scores else 0.0
    change_threshold = max(0.008, min(0.10, p70_change * 0.85 if p70_change > 0 else 0.008))
    scene_threshold = max(change_threshold * 2.4, min(0.30, p90_change * 1.15 if p90_change > 0 else change_threshold * 2.4))

    reliable_magnitudes = [
        float(item["translationMagnitude"])
        for item in samples[1:]
        if float(item.get("translationResponse", 0.0)) >= 0.18
    ]
    low_motion = max(0.0, _percentile(reliable_magnitudes, 0.25)) if reliable_magnitudes else 0.0
    translation_threshold = max(1.20, min(3.0, low_motion * 1.10 if low_motion > 0 else 1.20))
    motion_change_floor = max(0.0025, change_threshold * 0.30)

    for item in samples:
        magnitude = float(item.get("translationMagnitude", 0.0))
        response = float(item.get("translationResponse", 0.0))
        change_score = float(item.get("changeScore", 0.0))
        active = (
            int(item["index"]) > 0
            and response >= 0.18
            and magnitude >= translation_threshold
            and (change_score >= motion_change_floor or magnitude >= 4.0)
        )
        item["motionActive"] = active
        item["motionScore"] = round(magnitude * response, 6)
        item["apparentTranslationDirection"] = _direction_from_vector(float(item.get("translationX", 0.0)), float(item.get("translationY", 0.0)))
        item["inverseViewDirectionHint"] = _direction_from_vector(-float(item.get("translationX", 0.0)), -float(item.get("translationY", 0.0)))

    motion_windows = _build_motion_windows(samples, sample_interval)

    def inside_motion(timestamp: float) -> bool:
        return any(float(window["startSeconds"]) - 0.05 <= timestamp <= float(window["endSeconds"]) + 0.05 for window in motion_windows)

    change_candidates = sorted(
        (item for item in samples[1:] if float(item["changeScore"]) >= change_threshold),
        key=lambda item: float(item["changeScore"]),
        reverse=True,
    )
    chosen_changes: list[dict[str, Any]] = []
    change_limit = max(6, min(14, max_keyframes // 2 + 2))
    for item in change_candidates:
        timestamp = float(item["timestampSeconds"])
        score = float(item["changeScore"])
        if inside_motion(timestamp) and score < scene_threshold:
            continue
        if any(abs(timestamp - float(other["timestampSeconds"])) < max(0.30, min_gap_seconds) for other in chosen_changes):
            continue
        chosen_changes.append(item)
        if len(chosen_changes) >= change_limit:
            break

    events: list[dict[str, Any]] = []
    for window in motion_windows:
        events.append({**window})
    for item in chosen_changes:
        score = float(item["changeScore"])
        response = float(item.get("translationResponse", 0.0))
        kind = "scene-change" if score >= scene_threshold and response < 0.35 else "content-change"
        timestamp = float(item["timestampSeconds"])
        events.append({
            "kind": kind,
            "startSeconds": round(float(item.get("fromSeconds", timestamp)), 3),
            "endSeconds": round(timestamp, 3),
            "peakSeconds": round(timestamp, 3),
            "peakSampleIndex": int(item["index"]),
            "changeScore": round(score, 6),
            "translationResponse": round(response, 5),
        })
    events.sort(key=lambda item: (float(item["startSeconds"]), float(item.get("peakSeconds", item["startSeconds"]))))
    for event_index, event in enumerate(events):
        event["index"] = event_index

    representative_candidates: list[dict[str, Any]] = [{"timestamp": 0.0, "kind": "initial-state", "priority": 130.0, "event": None}]
    for event in events:
        if event["kind"] == "view-motion":
            peak_score = max(0.0, float(event.get("peakMotionScore", 0.0)))
            representative_candidates.append({
                "timestamp": float(event["peakSeconds"]),
                "kind": "motion-peak",
                "priority": 80.0 + min(20.0, math.log1p(peak_score) * 5.0),
                "event": event,
            })
        else:
            representative_candidates.append({
                "timestamp": float(event["peakSeconds"]),
                "kind": str(event["kind"]),
                "priority": 120.0 if event["kind"] == "scene-change" else 105.0,
                "event": event,
            })

    selected_candidates: list[dict[str, Any]] = []
    dedupe_gap = max(0.35, min(0.80, duration / max(1.0, max_keyframes * 6.0)))
    for candidate in sorted(representative_candidates, key=lambda item: float(item["priority"]), reverse=True):
        timestamp = max(0.0, min(duration, float(candidate["timestamp"])))
        if any(abs(timestamp - float(chosen["timestamp"])) < dedupe_gap for chosen in selected_candidates):
            continue
        selected_candidates.append({**candidate, "timestamp": timestamp})
        if len(selected_candidates) >= max_keyframes:
            break
    selected_candidates.sort(key=lambda item: float(item["timestamp"]))

    output_dir.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(source))
    records: list[dict[str, Any]] = []
    for candidate in selected_candidates:
        timestamp = float(candidate["timestamp"])
        frame = _read_frame(capture, timestamp)
        if frame is None:
            continue
        output = output_dir / f"keyframe_{len(records):03d}_{timestamp:08.3f}.jpg"
        if not cv2.imwrite(str(output), frame, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]):
            continue
        sample = _nearest_visual_sample(samples, timestamp)
        event_indices = [
            int(event["index"])
            for event in events
            if float(event["startSeconds"]) - 0.05 <= timestamp <= float(event["endSeconds"]) + 0.05
        ]
        record: dict[str, Any] = {
            "index": len(records),
            "timestampSeconds": round(timestamp, 3),
            "path": str(output.resolve()),
            "kind": str(candidate["kind"]),
            "eventIndices": event_indices,
        }
        if sample is not None:
            record["changeScore"] = float(sample.get("changeScore", 0.0))
            record["motion"] = {
                "active": bool(sample.get("motionActive")),
                "translationXAnalysisPixels": float(sample.get("translationX", 0.0)),
                "translationYAnalysisPixels": float(sample.get("translationY", 0.0)),
                "translationMagnitudeAnalysisPixels": float(sample.get("translationMagnitude", 0.0)),
                "response": float(sample.get("translationResponse", 0.0)),
                "apparentTranslationDirection": str(sample.get("apparentTranslationDirection", "still")),
                "inverseViewDirectionHint": str(sample.get("inverseViewDirectionHint", "still")),
            }
        records.append(record)
    capture.release()

    for event in events:
        event["representativeFrameIndices"] = [int(record["index"]) for record in records if int(event["index"]) in record.get("eventIndices", [])]

    return records, {
        "enabled": True,
        "available": True,
        "method": "adaptive-content-motion",
        "analysisFpsRequested": round(requested_analysis_fps, 3),
        "analysisFpsEffective": round(1.0 / sample_interval, 3) if sample_interval > 0 else round(effective_analysis_fps, 3),
        "analysisResolutionSeconds": round(sample_interval, 4),
        "analysisWidthPixels": 320,
        "sourceFramesDecoded": decoded_frames,
        "sampleCount": len(samples),
        "changeThreshold": round(change_threshold, 6),
        "sceneChangeThreshold": round(scene_threshold, 6),
        "translationThresholdAnalysisPixels": round(translation_threshold, 5),
        "motionWindowCount": len(motion_windows),
        "contentChangeEventCount": len(chosen_changes),
        "keyframeCount": len(records),
        "motionWindows": motion_windows,
        "events": events,
        "samples": samples,
        "note": "All source frames may be decoded sequentially, but only bounded reduced-resolution analysis samples and representative JPEGs are retained. Motion is apparent 2D image translation; inverse view direction is a hint, not a recovered 3D camera transform.",
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
