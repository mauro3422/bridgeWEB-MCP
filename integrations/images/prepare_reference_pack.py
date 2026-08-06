import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

CANONICAL_ROLES = {
    "front",
    "rear",
    "left",
    "right",
    "top",
    "bottom",
    "front_left_3q",
    "front_right_3q",
    "rear_left_3q",
    "rear_right_3q",
}
CONSTRUCTION_ROLES = {"front", "rear", "left", "right", "top", "bottom"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(path)
OPPOSITE_PAIRS = (("front", "rear"), ("left", "right"), ("top", "bottom"))


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
    margin_x = int(round(width * margin_ratio))
    margin_y = int(round(height * margin_ratio))
    image_width, image_height = image_size
    return (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(image_width, right + margin_x),
        min(image_height, bottom + margin_y),
    )


def normalized_landmarks(
    landmarks: dict | None,
    crop_bbox: tuple[int, int, int, int],
    resized_size: tuple[int, int],
    paste: tuple[int, int],
    target_size: tuple[int, int],
) -> dict:
    if not landmarks:
        return {}
    crop_left, crop_top, crop_right, crop_bottom = crop_bbox
    crop_width = max(1, crop_right - crop_left)
    crop_height = max(1, crop_bottom - crop_top)
    resized_width, resized_height = resized_size
    paste_x, paste_y = paste
    target_width, target_height = target_size
    output: dict[str, dict[str, float]] = {}
    for name, value in landmarks.items():
        if not isinstance(value, dict):
            continue
        x = value.get("x")
        y = value.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        source_x = float(x) * crop_width
        source_y = float(y) * crop_height
        output[name] = {
            "x": round((paste_x + source_x * resized_width / crop_width) / target_width, 6),
            "y": round((paste_y + source_y * resized_height / crop_height) / target_height, 6),
        }
    return output


def normalize_image(item: dict, config: dict, output_path: Path) -> dict:
    input_path = Path(item["inputPath"]).expanduser().resolve()
    source = ImageOps.exif_transpose(Image.open(input_path)).convert("RGBA")
    threshold = float(config.get("backgroundThreshold", 10))
    raw_bbox = foreground_bbox(source, threshold)
    crop_bbox = expand_bbox(raw_bbox, source.size, float(config.get("cropMargin", 0.04)))
    cropped = source.crop(crop_bbox)

    target_width = int(config.get("targetWidth", 1400))
    target_height = int(config.get("targetHeight", 1400))
    canvas_margin = float(config.get("canvasMargin", 0.06))
    usable_width = max(1, int(target_width * (1 - 2 * canvas_margin)))
    usable_height = max(1, int(target_height * (1 - 2 * canvas_margin)))
    scale = min(usable_width / cropped.width, usable_height / cropped.height)
    resized_size = (
        max(1, int(round(cropped.width * scale))),
        max(1, int(round(cropped.height * scale))),
    )
    resized = cropped.resize(resized_size, Image.Resampling.LANCZOS)

    alignment = config.get("alignment", "center")
    x = (target_width - resized.width) // 2
    if alignment == "baseline":
        bottom_margin = int(round(target_height * canvas_margin))
        y = max(0, target_height - bottom_margin - resized.height)
    else:
        y = max(0, (target_height - resized.height) // 2)

    canvas = Image.new("RGB", (target_width, target_height), "white")
    canvas.paste(resized.convert("RGB"), (x, y), resized.getchannel("A"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_format = config.get("outputFormat", "png")
    if output_format == "jpeg":
        canvas.save(
            output_path,
            "JPEG",
            quality=int(config.get("jpegQuality", 94)),
            optimize=True,
            progressive=True,
        )
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
    output_occupancy = {
        "left": round(x / target_width, 6),
        "top": round(y / target_height, 6),
        "right": round((x + resized.width) / target_width, 6),
        "bottom": round((y + resized.height) / target_height, 6),
        "width": round(resized.width / target_width, 6),
        "height": round(resized.height / target_height, 6),
        "centerX": round((x + resized.width / 2) / target_width, 6),
        "centerY": round((y + resized.height / 2) / target_height, 6),
    }
    warnings = [
        warning
        for warning, condition in [
            ("subject_touches_source_edge", any(touches_source_edge.values())),
            ("subject_is_too_small", subject_height_ratio < 0.35 and subject_width_ratio < 0.35),
            ("subject_is_too_wide", subject_width_ratio > 0.97),
        ]
        if condition
    ]

    return {
        "role": item["role"],
        "usage": item["usage"],
        "projection": item["projection"],
        "semanticQa": item.get("semanticQa", {"status": "pending", "notes": []}),
        "source": {
            "path": str(input_path),
            "width": source.width,
            "height": source.height,
            "bytes": input_path.stat().st_size,
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
            "alignment": alignment,
            "threshold": threshold,
            "cropMargin": float(config.get("cropMargin", 0.04)),
            "canvasMargin": canvas_margin,
            "outputOccupancy": output_occupancy,
            "landmarks": normalized_landmarks(
                item.get("landmarks"),
                crop_bbox,
                resized_size,
                (x, y),
                (target_width, target_height),
            ),
        },
        "quality": {
            "subjectWidthRatio": round(subject_width_ratio, 6),
            "subjectHeightRatio": round(subject_height_ratio, 6),
            "touchesSourceEdge": touches_source_edge,
            "warnings": warnings,
        },
    }


def pair_quality(items_by_role: dict[str, dict]) -> list[dict]:
    results = []
    for first, second in OPPOSITE_PAIRS:
        if first not in items_by_role or second not in items_by_role:
            continue
        a = items_by_role[first]["normalization"]["outputOccupancy"]
        b = items_by_role[second]["normalization"]["outputOccupancy"]
        width_delta = abs(a["width"] - b["width"])
        height_delta = abs(a["height"] - b["height"])
        center_x_delta = abs(a["centerX"] - b["centerX"])
        center_y_delta = abs(a["centerY"] - b["centerY"])
        warnings = []
        if max(width_delta, height_delta) > 0.12:
            warnings.append("paired_subject_scale_mismatch")
        if max(center_x_delta, center_y_delta) > 0.08:
            warnings.append("paired_subject_alignment_mismatch")
        results.append(
            {
                "roles": [first, second],
                "widthDelta": round(width_delta, 6),
                "heightDelta": round(height_delta, 6),
                "centerXDelta": round(center_x_delta, 6),
                "centerYDelta": round(center_y_delta, 6),
                "warnings": warnings,
            }
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    items = config["items"]
    roles = [item["role"] for item in items]
    if len(set(roles)) != len(roles):
        raise ValueError("Reference-pack roles must be unique")
    unknown_roles = sorted(set(roles) - CANONICAL_ROLES)
    if unknown_roles:
        raise ValueError(f"Unknown canonical roles: {', '.join(unknown_roles)}")

    output_format = config.get("outputFormat", "png")
    extension = ".jpg" if output_format == "jpeg" else ".png"
    output_dir = Path(config["outputDir"]).expanduser().resolve()
    manifest_path = Path(config["manifestPath"]).expanduser().resolve()
    overwrite = bool(config.get("overwrite", False))
    operation_mode = config.get("operationMode", "offline-preparation")
    user_modeling = bool(config.get("userModeling", False))
    target_blend_file = config.get("targetBlendFile")
    if operation_mode not in {"reference-only", "offline-preparation"}:
        raise ValueError(f"Unknown reference preparation operationMode: {operation_mode}")
    if user_modeling and operation_mode != "reference-only":
        raise ValueError("userModeling=true requires operationMode=reference-only")
    if target_blend_file:
        target_blend_file = str(Path(target_blend_file).expanduser().resolve())

    results = []
    for item in items:
        input_path = Path(item["inputPath"]).expanduser().resolve()
        if not input_path.is_file():
            raise FileNotFoundError(f"Input image not found: {input_path}")
        output_path = output_dir / f"{config['baseName']}_{item['role']}{extension}"
        if output_path.exists() and not overwrite:
            raise FileExistsError(f"Output image already exists: {output_path}")
        results.append(normalize_image(item, config, output_path))

    construction = [item for item in results if item["usage"] == "construction"]
    construction_heights = [item["normalization"]["outputOccupancy"]["height"] for item in construction]
    construction_widths = [item["normalization"]["outputOccupancy"]["width"] for item in construction]
    height_spread = max(construction_heights) - min(construction_heights) if construction_heights else 0
    width_spread = max(construction_widths) - min(construction_widths) if construction_widths else 0
    cross_warnings = []
    if height_spread > 0.18:
        cross_warnings.append("construction_height_varies_between_views")
    if width_spread > 0.35:
        cross_warnings.append("construction_width_varies_between_views")
    if not any(item["role"] == "front" and item["usage"] == "construction" for item in results):
        cross_warnings.append("geometric_front_missing")
    if not any(item["usage"] == "design" for item in results):
        cross_warnings.append("design_master_missing")

    items_by_role = {item["role"]: item for item in results}
    semantic_failures = [
        item["role"]
        for item in results
        if item.get("semanticQa", {}).get("status") == "fail"
    ]
    blocking_errors = [f"semantic_qa_failed:{role}" for role in semantic_failures]

    manifest = {
        "schemaVersion": 1,
        "kind": "blender-reference-pack",
        "stage": "prepared",
        "baseName": config["baseName"],
        "assetKind": config.get("assetKind", "prop"),
        "outputDir": str(output_dir),
        "preparedAt": utc_now(),
        "coordination": {
            "operationMode": operation_mode,
            "userModeling": user_modeling,
            "targetBlendFile": target_blend_file,
            "blenderInteractionAllowed": False,
            "installationDeferred": operation_mode == "reference-only",
            "allowedOperations": [
                "generate-images",
                "persist-images",
                "normalize-images",
                "validate-images",
                "write-manifest",
            ],
            "forbiddenLiveTools": [
                "blender_open",
                "blender_scene_info",
                "blender_execute_code",
                "blender_viewport_screenshot",
                "blender_focus_review",
                "blender_review_bundle",
            ],
            "handoff": "Install only after an exact .blend path, port, PID, and recent-activity preflight passes.",
        },
        "masters": config.get("masters", {}),
        "settings": {
            key: config.get(key)
            for key in [
                "targetWidth",
                "targetHeight",
                "backgroundThreshold",
                "cropMargin",
                "canvasMargin",
                "alignment",
                "outputFormat",
                "jpegQuality",
            ]
        },
        "crossViewQuality": {
            "constructionHeightSpread": round(height_spread, 6),
            "constructionWidthSpread": round(width_spread, 6),
            "pairs": pair_quality(items_by_role),
            "warnings": cross_warnings,
        },
        "blockingErrors": blocking_errors,
        "items": results,
    }
    atomic_write_json(manifest_path, manifest)
    persisted_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if persisted_manifest != manifest:
        raise RuntimeError("Reference-pack manifest readback does not match the generated manifest")
    print("REFERENCE_PACK_PREPARED=" + json.dumps(persisted_manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
