from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import warnings
import uuid
from pathlib import Path

from PIL import Image

MAX_SOURCE_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _flatten_to_rgb(image: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, (*background, 255))
        canvas.alpha_composite(rgba)
        return canvas.convert("RGB")
    return image.convert("RGB")


def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
        subsampling=1,
    )
    return buffer.getvalue()


def _fit_within(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    if image.width <= max_width and image.height <= max_height:
        return image.copy()
    copy = image.copy()
    copy.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    return copy


def _parse_background(value: str) -> tuple[int, int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError("background must be a 6-digit RGB hex value")
    return tuple(int(raw[index:index + 2], 16) for index in (0, 2, 4))


def prepare(config: dict) -> dict:
    input_path = Path(config["inputPath"])
    output_path = Path(config["outputPath"])
    max_width = int(config.get("maxWidth", 1600))
    max_height = int(config.get("maxHeight", 1600))
    max_bytes = int(config.get("maxBytes", 180_000))
    start_quality = int(config.get("jpegQuality", 90))
    min_quality = int(config.get("minJpegQuality", 58))
    background = _parse_background(str(config.get("background", "101217")))
    max_source_pixels = int(config.get("maxSourcePixels", MAX_SOURCE_PIXELS))
    source_bytes = input_path.read_bytes()
    source_sha256 = _sha256(source_bytes)
    expected_source_sha256 = str(config.get("expectedSourceSha256", "")).lower()
    if len(expected_source_sha256) != 64 or source_sha256 != expected_source_sha256:
        raise ValueError("source snapshot SHA-256 does not match the inspected source bytes")

    with Image.open(io.BytesIO(source_bytes)) as source:
        if source.width * source.height > max_source_pixels:
            raise ValueError(f"source exceeds the {max_source_pixels}-pixel processing limit")
        source.load()
        source_width, source_height = source.size
        image = _flatten_to_rgb(source, background)

    image = _fit_within(image, max_width, max_height)
    quality = start_quality
    encoded = _encode_jpeg(image, quality)

    while len(encoded) > max_bytes:
        if quality > min_quality:
            quality = max(min_quality, quality - 4)
        else:
            next_width = max(256, int(image.width * 0.9))
            next_height = max(256, int(image.height * 0.9))
            if next_width == image.width and next_height == image.height:
                break
            image = image.resize((next_width, next_height), Image.Resampling.LANCZOS)
            quality = start_quality
        encoded = _encode_jpeg(image, quality)

    if len(encoded) > max_bytes:
        raise RuntimeError(
            f"Unable to fit preview under {max_bytes} bytes without shrinking below the safe floor; got {len(encoded)} bytes"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() or output_path.is_symlink():
        raise FileExistsError(f"chat preview output already exists: {output_path}")
    temp_path = output_path.with_name(f".{output_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temp_path.open("xb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        # Hard-link creation is atomic and fails if another writer created the target.
        # Both paths are in the output directory so the operation stays on one volume.
        os.link(temp_path, output_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    return {
        "inputPath": str(input_path),
        "outputPath": str(output_path),
        "sourceSha256": source_sha256,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "width": image.width,
        "height": image.height,
        "bytes": len(encoded),
        "sha256": _sha256(encoded),
        "jpegQuality": quality,
        "maxBytes": max_bytes,
        "format": "jpeg",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    result = prepare(config)
    print("CHAT_PREVIEW_PREPARED=" + json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
