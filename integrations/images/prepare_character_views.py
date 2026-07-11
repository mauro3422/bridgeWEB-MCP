import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    height, width, _ = rgb.shape
    patch_h = max(2, int(height * 0.04))
    patch_w = max(2, int(width * 0.04))
    corners = np.concatenate(
        [
            rgb[:patch_h, :patch_w].reshape(-1, 3),
            rgb[:patch_h, width - patch_w :].reshape(-1, 3),
            rgb[height - patch_h :, :patch_w].reshape(-1, 3),
            rgb[height - patch_h :, width - patch_w :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(corners, axis=0)


def foreground_bbox(image: Image.Image, threshold: float) -> tuple[int, int, int, int]:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.int16)
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    background = estimate_background(rgb)
    color_distance = np.max(np.abs(rgb - background), axis=2)
    mask = (color_distance >= threshold) | (alpha < 250)

    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return (0, 0, image.width, image.height)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def expand_bbox(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    margin_ratio: float,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    width = max(1, right - left)
    height = max(1, bottom - top)
    margin_x = int(width * margin_ratio)
    margin_y = int(height * margin_ratio)
    image_width, image_height = image_size
    return (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(image_width, right + margin_x),
        min(image_height, bottom + margin_y),
    )


def normalize_image(
    input_path: Path,
    output_path: Path,
    target_width: int,
    target_height: int,
    threshold: float,
    crop_margin: float,
    canvas_margin: float,
    output_format: str,
    jpeg_quality: int,
) -> dict:
    source = ImageOps.exif_transpose(Image.open(input_path)).convert("RGBA")
    raw_bbox = foreground_bbox(source, threshold)
    crop_bbox = expand_bbox(raw_bbox, source.size, crop_margin)
    cropped = source.crop(crop_bbox)

    usable_width = max(1, int(target_width * (1 - 2 * canvas_margin)))
    usable_height = max(1, int(target_height * (1 - 2 * canvas_margin)))
    scale = min(usable_width / cropped.width, usable_height / cropped.height)
    resized_size = (
        max(1, int(round(cropped.width * scale))),
        max(1, int(round(cropped.height * scale))),
    )
    resized = cropped.resize(resized_size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (target_width, target_height), "white")
    x = (target_width - resized.width) // 2
    bottom_margin = int(target_height * canvas_margin)
    y = target_height - bottom_margin - resized.height
    if y < 0:
        y = max(0, (target_height - resized.height) // 2)
    alpha = resized.getchannel("A")
    canvas.paste(resized.convert("RGB"), (x, y), alpha)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "jpeg":
        canvas.save(output_path, "JPEG", quality=jpeg_quality, optimize=True, progressive=True)
    else:
        canvas.save(output_path, "PNG", optimize=True)

    touches_source_edge = {
        "left": raw_bbox[0] <= 1,
        "top": raw_bbox[1] <= 1,
        "right": raw_bbox[2] >= source.width - 1,
        "bottom": raw_bbox[3] >= source.height - 1,
    }
    subject_width_ratio = (raw_bbox[2] - raw_bbox[0]) / source.width
    subject_height_ratio = (raw_bbox[3] - raw_bbox[1]) / source.height

    return {
        "source": {
            "path": str(input_path),
            "width": source.width,
            "height": source.height,
            "sha256": sha256(input_path),
        },
        "output": {
            "path": str(output_path),
            "width": target_width,
            "height": target_height,
            "bytes": output_path.stat().st_size,
            "sha256": sha256(output_path),
            "format": output_format,
        },
        "normalization": {
            "rawForegroundBbox": list(raw_bbox),
            "cropBbox": list(crop_bbox),
            "resizedWidth": resized.width,
            "resizedHeight": resized.height,
            "pasteX": x,
            "pasteY": y,
            "threshold": threshold,
            "cropMargin": crop_margin,
            "canvasMargin": canvas_margin,
        },
        "quality": {
            "subjectWidthRatio": round(subject_width_ratio, 4),
            "subjectHeightRatio": round(subject_height_ratio, 4),
            "touchesSourceEdge": touches_source_edge,
            "warnings": [
                warning
                for warning, condition in [
                    ("subject_touches_source_edge", any(touches_source_edge.values())),
                    ("subject_is_too_small", subject_height_ratio < 0.45),
                    ("subject_is_too_wide", subject_width_ratio > 0.95),
                ]
                if condition
            ],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    output_format = config.get("outputFormat", "jpeg")
    extension = ".jpg" if output_format == "jpeg" else ".png"
    output_dir = Path(config["outputDir"]).expanduser().resolve()
    manifest_path = Path(config["manifestPath"]).expanduser().resolve()
    overwrite = bool(config.get("overwrite", False))

    results = []
    for item in config["items"]:
        input_path = Path(item["inputPath"]).expanduser().resolve()
        if not input_path.is_file():
            raise FileNotFoundError(f"Input image not found: {input_path}")
        role = item["role"]
        output_path = output_dir / f"{config['baseName']}_{role}{extension}"
        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output image already exists: {output_path}")
        result = normalize_image(
            input_path=input_path,
            output_path=output_path,
            target_width=int(config.get("targetWidth", 1024)),
            target_height=int(config.get("targetHeight", 1280)),
            threshold=float(config.get("backgroundThreshold", 10)),
            crop_margin=float(config.get("cropMargin", 0.04)),
            canvas_margin=float(config.get("canvasMargin", 0.06)),
            output_format=output_format,
            jpeg_quality=int(config.get("jpegQuality", 92)),
        )
        result["role"] = role
        results.append(result)

    heights = [item["quality"]["subjectHeightRatio"] for item in results]
    spread = max(heights) - min(heights) if heights else 0
    cross_view_warnings = []
    if spread > 0.18:
        cross_view_warnings.append("subject_scale_varies_between_views")

    manifest = {
        "schemaVersion": 1,
        "stage": "views_normalized",
        "baseName": config["baseName"],
        "outputDir": str(output_dir),
        "settings": {
            key: config.get(key)
            for key in [
                "targetWidth",
                "targetHeight",
                "backgroundThreshold",
                "cropMargin",
                "canvasMargin",
                "outputFormat",
                "jpegQuality",
            ]
        },
        "crossViewQuality": {
            "subjectHeightRatioSpread": round(spread, 4),
            "warnings": cross_view_warnings,
        },
        "items": results,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("CHARACTER_VIEWS_PREPARED=" + json.dumps(manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
