from __future__ import annotations

import concurrent.futures
import json
import math
import os
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

import cv2
import imageio_ffmpeg
import speech_recognition as sr


def _run(command: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        frame_rate = handle.getframerate()
        if frame_rate <= 0:
            return 0.0
        return handle.getnframes() / float(frame_rate)


def _extract_audio(source: Path, wav_path: Path, timeout: float) -> tuple[bool, str | None]:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    result = _run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(wav_path),
        ],
        timeout,
    )
    if result.returncode == 0 and wav_path.exists() and wav_path.stat().st_size > 44:
        return True, None
    message = (result.stderr or result.stdout or "no audio stream").strip()
    return False, message[-1200:] if message else "no audio stream"


def _video_metadata(source: Path) -> tuple[dict[str, Any], Any | None]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        capture.release()
        return {
            "hasVideo": False,
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "frameCount": 0,
            "durationSeconds": 0.0,
        }, None

    width = max(0, int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0))
    height = max(0, int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0))
    fps = max(0.0, float(capture.get(cv2.CAP_PROP_FPS) or 0.0))
    frame_count = max(0, int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
    duration = frame_count / fps if fps > 0.0 and frame_count > 0 else 0.0
    has_video = width > 0 and height > 0 and (frame_count > 0 or duration > 0.0)
    if not has_video:
        capture.release()
        return {
            "hasVideo": False,
            "width": width,
            "height": height,
            "fps": fps,
            "frameCount": frame_count,
            "durationSeconds": duration,
        }, None

    return {
        "hasVideo": True,
        "width": width,
        "height": height,
        "fps": round(fps, 6),
        "frameCount": frame_count,
        "durationSeconds": round(duration, 6),
    }, capture


def _frame_timestamps(duration: float, interval: float, max_frames: int) -> list[float]:
    if duration <= 0.0 or max_frames <= 0:
        return []
    interval = max(interval, 0.25)
    values: list[float] = []
    current = 0.0
    while current < duration and len(values) < max_frames:
        values.append(current)
        current += interval
    tail = max(duration - min(interval * 0.25, 0.5), 0.0)
    if len(values) < max_frames and (not values or tail - values[-1] > interval * 0.35):
        values.append(tail)
    return values[:max_frames]


def _extract_frames(
    capture: Any,
    frames_dir: Path,
    duration: float,
    interval: float,
    max_frames: int,
    jpeg_quality: int,
) -> list[dict[str, Any]]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    frames: list[dict[str, Any]] = []
    for index, timestamp in enumerate(_frame_timestamps(duration, interval, max_frames)):
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        output = frames_dir / f"frame_{index:03d}_{timestamp:08.3f}.jpg"
        written = cv2.imwrite(str(output), frame, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
        if not written:
            continue
        frames.append({
            "index": len(frames),
            "timestampSeconds": round(timestamp, 3),
            "path": str(output.resolve()),
        })
    capture.release()
    return frames


def _recognize_segment(
    wav_path: Path,
    start: float,
    duration: float,
    primary_language: str,
    fallback_language: str | None,
) -> dict[str, Any]:
    recognizer = sr.Recognizer()
    with sr.AudioFile(str(wav_path)) as source:
        audio = recognizer.record(source, offset=start, duration=duration)

    attempts: list[dict[str, str]] = []
    languages = [primary_language]
    if fallback_language and fallback_language != primary_language:
        languages.append(fallback_language)

    for language in languages:
        try:
            text = recognizer.recognize_google(audio, language=language).strip()
            if text:
                return {"text": text, "language": language, "attempts": attempts}
            attempts.append({"language": language, "error": "empty transcript"})
        except sr.UnknownValueError:
            attempts.append({"language": language, "error": "speech not understood"})
        except sr.RequestError as error:
            attempts.append({"language": language, "error": f"request error: {error}"})
        except Exception as error:  # bounded diagnostic, segment continues
            attempts.append({"language": language, "error": f"{type(error).__name__}: {error}"})

    return {"text": "", "language": None, "attempts": attempts}


def _transcribe(
    wav_path: Path,
    duration: float,
    segment_seconds: float,
    primary_language: str,
    fallback_language: str | None,
    max_workers: int,
) -> dict[str, Any]:
    segment_count = max(1, int(math.ceil(duration / segment_seconds)))
    specs: list[tuple[int, float, float]] = []
    for index in range(segment_count):
        start = index * segment_seconds
        end = min(duration, start + segment_seconds)
        if end <= start:
            continue
        specs.append((index, start, end))

    segments: list[dict[str, Any]] = []
    worker_count = max(1, min(max_workers, len(specs), 4))
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
        pending = {
            executor.submit(
                _recognize_segment,
                wav_path,
                start,
                end - start,
                primary_language,
                fallback_language,
            ): (index, start, end)
            for index, start, end in specs
        }
        for future in concurrent.futures.as_completed(pending):
            index, start, end = pending[future]
            try:
                recognized = future.result()
            except Exception as error:
                recognized = {
                    "text": "",
                    "language": None,
                    "attempts": [{"language": primary_language, "error": f"{type(error).__name__}: {error}"}],
                }
            segments.append({
                "index": index,
                "startSeconds": round(start, 3),
                "endSeconds": round(end, 3),
                **recognized,
            })

    segments.sort(key=lambda item: int(item["index"]))
    transcript = " ".join(str(item.get("text", "")).strip() for item in segments if str(item.get("text", "")).strip())
    return {
        "enabled": True,
        "provider": "google_speech_recognition",
        "primaryLanguage": primary_language,
        "fallbackLanguage": fallback_language,
        "segmentSeconds": segment_seconds,
        "segments": segments,
        "transcript": transcript,
    }


def _nearest_frame_indices(frames: list[dict[str, Any]], start: float, end: float) -> list[int]:
    if not frames:
        return []
    inside = [
        int(frame["index"])
        for frame in frames
        if start <= float(frame["timestampSeconds"]) <= end
    ]
    if inside:
        return inside
    middle = (start + end) * 0.5
    nearest = min(frames, key=lambda frame: abs(float(frame["timestampSeconds"]) - middle))
    return [int(nearest["index"])]


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: review_media.py <config.json>")

    config_path = Path(sys.argv[1]).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    source = Path(config["sourcePath"]).resolve()
    output_dir = Path(config["outputDir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    review_path = output_dir / "review.json"
    wav_path = output_dir / "audio_16k_mono.wav"

    segment_seconds = float(config.get("segmentSeconds", 10.0))
    frame_interval = float(config.get("frameIntervalSeconds", 4.0))
    max_frames = int(config.get("maxFrames", 30))
    transcribe = bool(config.get("transcribe", True))
    primary_language = str(config.get("primaryLanguage", "es-AR"))
    fallback_language_raw = config.get("fallbackLanguage", "en-US")
    fallback_language = str(fallback_language_raw) if fallback_language_raw else None
    keep_audio = bool(config.get("keepAudio", False))
    max_workers = int(config.get("maxWorkers", 3))
    process_timeout = float(config.get("processTimeoutSeconds", 120.0))
    jpeg_quality = max(55, min(int(config.get("jpegQuality", 86)), 95))

    warnings: list[str] = []
    video, capture = _video_metadata(source)
    frames: list[dict[str, Any]] = []
    if capture is not None:
        frames = _extract_frames(capture, output_dir / "frames", float(video["durationSeconds"]), frame_interval, max_frames, jpeg_quality)
        if not frames:
            warnings.append("video stream opened but no review frames were extracted")

    audio_ok, audio_error = _extract_audio(source, wav_path, process_timeout)
    audio_duration = 0.0
    if audio_ok:
        audio_duration = _wav_duration(wav_path)
    elif audio_error:
        warnings.append(f"audio extraction unavailable: {audio_error}")

    duration_candidates = [float(video.get("durationSeconds", 0.0)), audio_duration]
    duration = max(duration_candidates)

    if transcribe and audio_ok and audio_duration > 0.0:
        transcription = _transcribe(
            wav_path,
            audio_duration,
            segment_seconds,
            primary_language,
            fallback_language,
            max_workers,
        )
        if not transcription["transcript"]:
            warnings.append("Google ASR returned no recognized text")
    elif transcribe:
        transcription = {
            "enabled": True,
            "provider": "google_speech_recognition",
            "primaryLanguage": primary_language,
            "fallbackLanguage": fallback_language,
            "segmentSeconds": segment_seconds,
            "segments": [],
            "transcript": "",
        }
    else:
        transcription = {
            "enabled": False,
            "provider": None,
            "primaryLanguage": primary_language,
            "fallbackLanguage": fallback_language,
            "segmentSeconds": segment_seconds,
            "segments": [],
            "transcript": "",
        }

    timeline: list[dict[str, Any]] = []
    if transcription["segments"]:
        for segment in transcription["segments"]:
            start = float(segment["startSeconds"])
            end = float(segment["endSeconds"])
            timeline.append({
                "index": int(segment["index"]),
                "startSeconds": start,
                "endSeconds": end,
                "text": segment.get("text", ""),
                "language": segment.get("language"),
                "frameIndices": _nearest_frame_indices(frames, start, end),
            })
    elif frames:
        for index, frame in enumerate(frames):
            start = float(frame["timestampSeconds"])
            next_time = float(frames[index + 1]["timestampSeconds"]) if index + 1 < len(frames) else duration
            timeline.append({
                "index": index,
                "startSeconds": round(start, 3),
                "endSeconds": round(max(start, next_time), 3),
                "text": "",
                "language": None,
                "frameIndices": [int(frame["index"])],
            })

    review = {
        "schemaVersion": 1,
        "sourcePath": str(source),
        "durationSeconds": round(duration, 6),
        "video": video,
        "audio": {
            "hasAudio": audio_ok,
            "durationSeconds": round(audio_duration, 6),
            "sampleRate": 16000 if audio_ok else None,
            "channels": 1 if audio_ok else None,
            "path": str(wav_path.resolve()) if audio_ok and keep_audio else None,
        },
        "frames": frames,
        "transcription": transcription,
        "timeline": timeline,
        "warnings": warnings,
    }
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")

    if audio_ok and not keep_audio:
        try:
            wav_path.unlink()
        except OSError:
            pass

    print(json.dumps({
        "success": True,
        "reviewPath": str(review_path.resolve()),
        "durationSeconds": review["durationSeconds"],
        "frameCount": len(frames),
        "transcriptCharacters": len(str(transcription.get("transcript", ""))),
        "warningCount": len(warnings),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
