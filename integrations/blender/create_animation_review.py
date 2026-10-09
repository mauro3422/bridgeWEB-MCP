from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import runpy
from typing import Iterable

import bpy
from mathutils import Vector


TEMP_COLLECTION_NAME = "__BRIDGE_ANIMATION_REVIEW_TEMP__"
TEMP_CAMERA_NAME = "__BRIDGE_ANIMATION_REVIEW_CAMERA__"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_review_helpers() -> dict:
    return runpy.run_path(str(Path(__file__).with_name("create_review_bundle.py")))


def _frame_bounds(objects: list[bpy.types.Object]) -> tuple[list[Vector], Vector, Vector, Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    points: list[Vector] = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            points.append(evaluated.matrix_world @ Vector(corner))
    if not points:
        raise RuntimeError("Animation review targets do not expose a usable evaluated bounding box")
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    center = (minimum + maximum) * 0.5
    dimensions = maximum - minimum
    return points, minimum, maximum, center, dimensions


def _bounds_record(frame: int, minimum: Vector, maximum: Vector, center: Vector, dimensions: Vector) -> dict:
    return {
        "frame": frame,
        "minimum": [round(float(value), 6) for value in minimum],
        "maximum": [round(float(value), 6) for value in maximum],
        "center": [round(float(value), 6) for value in center],
        "dimensions": [round(float(value), 6) for value in dimensions],
    }


def create_animation_review(config: dict) -> dict:
    helpers = _load_review_helpers()
    collect_targets = helpers["_collect_targets"]
    configure_camera = helpers["_configure_camera"]
    make_contact_sheet = helpers["_make_contact_sheet"]
    safe_name = helpers["_safe_name"]
    sha256_file = helpers["_sha256_file"]
    rig_context = helpers["_rig_context"]
    view_directions = helpers["VIEW_DIRECTIONS"]

    scene = bpy.context.scene
    output_dir = Path(config["output_dir"]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = safe_name(str(config.get("file_prefix") or "blender-animation-review"), "blender-animation-review")
    frames = [int(value) for value in config.get("frames", [])]
    if not frames:
        raise ValueError("At least one animation review frame is required")
    if len(frames) > 24:
        raise ValueError("Animation review supports at most 24 frames per call")
    if len(set(frames)) != len(frames):
        raise ValueError("Animation review frames must not contain duplicates")
    frame_min = int(scene.frame_start)
    frame_max = int(scene.frame_end)
    outside = [frame for frame in frames if frame < frame_min or frame > frame_max]
    if outside:
        raise ValueError(f"Animation review frames fall outside scene range {frame_min}..{frame_max}: {outside}")

    view = str(config.get("view") or "three-quarter")
    if view not in view_directions:
        raise ValueError(f"Unsupported animation review view: {view}")
    resolution = int(config.get("resolution", 640))
    margin = float(config.get("margin", 1.18))
    transparent = bool(config.get("transparent_background", False))
    create_contact = bool(config.get("create_contact_sheet", True))
    overwrite = bool(config.get("overwrite", False))

    targets, warnings = collect_targets(config)
    if not targets:
        raise RuntimeError("No renderable targets found for animation review")

    artifact_paths = [output_dir / f"{prefix}_f{frame:04d}_{view}.png" for frame in frames]
    contact_path = output_dir / f"{prefix}_{view}_contact.png"
    manifest_path = output_dir / f"{prefix}_animation_review.json"
    requested_paths = artifact_paths + ([contact_path] if create_contact else []) + [manifest_path]
    existing = [str(item) for item in requested_paths if item.exists()]
    if existing and not overwrite:
        raise FileExistsError(f"Animation review artifacts already exist; set overwrite=true or use a new filePrefix: {existing}")

    saved_scene = {
        "frame": int(scene.frame_current),
        "camera": scene.camera,
        "render_engine": scene.render.engine,
        "resolution_x": scene.render.resolution_x,
        "resolution_y": scene.render.resolution_y,
        "resolution_percentage": scene.render.resolution_percentage,
        "filepath": scene.render.filepath,
        "film_transparent": scene.render.film_transparent,
        "file_format": scene.render.image_settings.file_format,
        "color_mode": scene.render.image_settings.color_mode,
    }
    saved_hide_render = {obj.name: bool(obj.hide_render) for obj in scene.objects}
    shading = scene.display.shading
    shading_attrs = [
        "light", "color_type", "show_shadows", "show_cavity", "cavity_type",
        "show_specular_highlight", "background_type", "background_color",
    ]
    saved_shading = {name: getattr(shading, name) for name in shading_attrs if hasattr(shading, name)}

    temporary_collection = bpy.data.collections.get(TEMP_COLLECTION_NAME)
    if temporary_collection is not None:
        for obj in list(temporary_collection.objects):
            temporary_collection.objects.unlink(obj)
        bpy.data.collections.remove(temporary_collection)
    temporary_collection = bpy.data.collections.new(TEMP_COLLECTION_NAME)
    scene.collection.children.link(temporary_collection)
    camera_data = bpy.data.cameras.new(TEMP_CAMERA_NAME)
    camera = bpy.data.objects.new(TEMP_CAMERA_NAME, camera_data)
    temporary_collection.objects.link(camera)

    rendered: list[dict] = []
    frame_bounds: list[dict] = []
    union_points: list[Vector] = []
    result: dict | None = None

    try:
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            points, minimum, maximum, center, dimensions = _frame_bounds(targets)
            union_points.extend(points)
            frame_bounds.append(_bounds_record(frame, minimum, maximum, center, dimensions))

        union_min = Vector((
            min(point.x for point in union_points),
            min(point.y for point in union_points),
            min(point.z for point in union_points),
        ))
        union_max = Vector((
            max(point.x for point in union_points),
            max(point.y for point in union_points),
            max(point.z for point in union_points),
        ))
        union_center = (union_min + union_max) * 0.5
        union_dimensions = union_max - union_min
        configure_camera(camera, union_center, union_points, view, margin)

        for obj in scene.objects:
            obj.hide_render = obj not in targets and obj != camera
        for target in targets:
            target.hide_render = False

        scene.camera = camera
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.resolution_x = resolution
        scene.render.resolution_y = resolution
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = transparent
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        for attribute, value in (
            ("light", "STUDIO"),
            ("color_type", "MATERIAL"),
            ("show_shadows", True),
            ("show_cavity", True),
            ("cavity_type", "WORLD"),
            ("show_specular_highlight", True),
            ("background_type", "VIEWPORT"),
            ("background_color", (0.025, 0.03, 0.04)),
        ):
            if hasattr(shading, attribute):
                try:
                    setattr(shading, attribute, value)
                except (TypeError, ValueError):
                    pass

        for frame, output_path in zip(frames, artifact_paths):
            scene.frame_set(frame)
            scene.render.filepath = str(output_path)
            bpy.context.view_layer.update()
            bpy.ops.render.render(write_still=True)
            if not output_path.exists():
                raise RuntimeError(f"Blender did not produce expected animation-review render: {output_path}")
            rendered.append({
                "frame": frame,
                "view": view,
                "path": str(output_path),
                "width": resolution,
                "height": resolution,
                "bytes": output_path.stat().st_size,
                "sha256": sha256_file(output_path),
            })

        contact = make_contact_sheet(artifact_paths, contact_path) if create_contact else None
        result = {
            "stage": "animation_review_created",
            "created_at": _utc_now(),
            "blender": {
                "version": bpy.app.version_string,
                "file": bpy.data.filepath or None,
                "scene": scene.name,
            },
            "request": {
                "frames": frames,
                "view": view,
                "resolution": resolution,
                "margin": margin,
                "transparent_background": transparent,
                "target_collections": list(config.get("target_collections", [])),
                "target_objects": list(config.get("target_objects", [])),
            },
            "camera_contract": {
                "mode": "fixed-across-frames",
                "projection": "orthographic",
                "location": [round(float(value), 6) for value in camera.location],
                "rotation_euler": [round(float(value), 6) for value in camera.rotation_euler],
                "ortho_scale": round(float(camera.data.ortho_scale), 6),
            },
            "union_bounds": {
                "minimum": [round(float(value), 6) for value in union_min],
                "maximum": [round(float(value), 6) for value in union_max],
                "center": [round(float(value), 6) for value in union_center],
                "dimensions": [round(float(value), 6) for value in union_dimensions],
            },
            "frame_bounds": frame_bounds,
            "rig": rig_context(targets),
            "warnings": warnings,
            "renders": rendered,
            "contact_sheet": contact,
            "restoration": {"attempted": True, "completed": False},
        }
        manifest_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        result["manifest"] = {
            "path": str(manifest_path),
            "bytes": manifest_path.stat().st_size,
            "sha256": sha256_file(manifest_path),
        }
        return result
    finally:
        scene.camera = saved_scene["camera"]
        scene.render.engine = saved_scene["render_engine"]
        scene.render.resolution_x = saved_scene["resolution_x"]
        scene.render.resolution_y = saved_scene["resolution_y"]
        scene.render.resolution_percentage = saved_scene["resolution_percentage"]
        scene.render.filepath = saved_scene["filepath"]
        scene.render.film_transparent = saved_scene["film_transparent"]
        scene.render.image_settings.file_format = saved_scene["file_format"]
        scene.render.image_settings.color_mode = saved_scene["color_mode"]
        for name, value in saved_shading.items():
            if hasattr(shading, name):
                try:
                    setattr(shading, name, value)
                except (TypeError, ValueError):
                    pass
        for obj in scene.objects:
            if obj.name in saved_hide_render:
                obj.hide_render = saved_hide_render[obj.name]
        if camera.name in bpy.data.objects:
            bpy.data.objects.remove(camera, do_unlink=True)
        if camera_data.name in bpy.data.cameras:
            bpy.data.cameras.remove(camera_data)
        if temporary_collection.name in bpy.data.collections:
            for obj in list(temporary_collection.objects):
                temporary_collection.objects.unlink(obj)
            bpy.data.collections.remove(temporary_collection)
        scene.frame_set(saved_scene["frame"])
        bpy.context.view_layer.update()
        if result is not None:
            result["restoration"]["completed"] = True
            manifest_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
            result["manifest"] = {
                "path": str(manifest_path),
                "bytes": manifest_path.stat().st_size,
                "sha256": sha256_file(manifest_path),
            }
