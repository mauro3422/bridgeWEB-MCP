from __future__ import annotations

from datetime import datetime, timezone
import bmesh
import hashlib
import json
from pathlib import Path
import re

import bpy
from mathutils import Vector


RENDERABLE_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT", "ARMATURE"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_name(value: str, fallback: str = "blender-focus") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return cleaned[:96] or fallback


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _viewport_context():
    window = bpy.context.window
    screen = window.screen if window else None
    if window is None or screen is None:
        raise RuntimeError("No Blender window/screen is available")
    area = next((candidate for candidate in screen.areas if candidate.type == "VIEW_3D"), None)
    if area is None:
        raise RuntimeError("No VIEW_3D area is available")
    region = next((candidate for candidate in area.regions if candidate.type == "WINDOW"), None)
    if region is None:
        raise RuntimeError("No VIEW_3D window region is available")
    space = area.spaces.active
    region_3d = space.region_3d
    return window, screen, area, region, space, region_3d


def _view_state(region_3d) -> dict:
    return {
        "location": [round(float(value), 8) for value in region_3d.view_location],
        "distance": round(float(region_3d.view_distance), 8),
        "rotation": [round(float(value), 8) for value in region_3d.view_rotation],
        "perspective": str(region_3d.view_perspective),
        "camera_zoom": round(float(region_3d.view_camera_zoom), 8),
        "camera_offset": [round(float(value), 8) for value in region_3d.view_camera_offset],
    }


def _capture_viewport(output: Path, max_size: int, context) -> dict:
    window, screen, area, region, _space, _region_3d = context
    output.parent.mkdir(parents=True, exist_ok=True)
    area.tag_redraw()
    with bpy.context.temp_override(window=window, screen=screen, area=area, region=region):
        bpy.ops.screen.screenshot_area(filepath=str(output))

    if not output.exists():
        raise RuntimeError(f"Blender did not produce the expected viewport capture: {output}")

    image = bpy.data.images.load(str(output), check_existing=False)
    try:
        width, height = (int(image.size[0]), int(image.size[1]))
        if max(width, height) > max_size:
            scale = max_size / max(width, height)
            width = max(1, int(width * scale))
            height = max(1, int(height * scale))
            image.scale(width, height)
            image.filepath_raw = str(output)
            image.file_format = "PNG"
            image.save()
        return {
            "path": str(output),
            "width": width,
            "height": height,
            "bytes": output.stat().st_size,
            "sha256": _sha256_file(output),
        }
    finally:
        bpy.data.images.remove(image)


def _world_bounds_points(obj: bpy.types.Object) -> list[Vector]:
    if obj.type not in RENDERABLE_TYPES:
        return [obj.matrix_world.translation.copy()]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    try:
        return [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    except Exception:
        return [obj.matrix_world.translation.copy()]


def _selected_edit_points(obj: bpy.types.Object | None) -> list[Vector]:
    if obj is None or obj.type != "MESH" or obj.mode != "EDIT":
        return []
    mesh = bmesh.from_edit_mesh(obj.data)
    return [obj.matrix_world @ vertex.co for vertex in mesh.verts if vertex.select]


def _center_radius(points: list[Vector]) -> tuple[Vector, float]:
    if not points:
        raise RuntimeError("Cannot measure an empty focus point set")
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    center = (minimum + maximum) * 0.5
    radius = max((point - center).length for point in points)
    return center, max(float(radius), 0.001)


def _resolve_focus(mode: str, current_distance: float) -> dict:
    active = bpy.context.view_layer.objects.active
    edit_points = _selected_edit_points(active)
    selected_objects = [obj for obj in bpy.context.selected_objects if obj.type in RENDERABLE_TYPES]

    if mode in {"auto", "selection"} and edit_points:
        object_points = _world_bounds_points(active)
        center, selected_radius = _center_radius(edit_points)
        _object_center, object_radius = _center_radius(object_points)
        return {
            "source": "edit-selection",
            "center": center,
            "focus_radius": selected_radius,
            "object_radius": object_radius,
            "object_names": [active.name],
            "selected_component_count": len(edit_points),
        }

    if mode in {"auto", "selection"} and selected_objects:
        points = [point for obj in selected_objects for point in _world_bounds_points(obj)]
        center, radius = _center_radius(points)
        return {
            "source": "object-selection",
            "center": center,
            "focus_radius": radius,
            "object_radius": radius,
            "object_names": [obj.name for obj in selected_objects],
            "selected_component_count": 0,
        }

    if mode == "selection":
        raise RuntimeError("focusMode=selection requires selected mesh components or selected objects")

    if mode in {"auto", "active-object"} and active is not None:
        points = _world_bounds_points(active)
        center, radius = _center_radius(points)
        return {
            "source": "active-object",
            "center": center,
            "focus_radius": radius,
            "object_radius": radius,
            "object_names": [active.name],
            "selected_component_count": 0,
        }

    if mode == "active-object":
        raise RuntimeError("focusMode=active-object requires an active object")

    cursor = bpy.context.scene.cursor.location.copy()
    return {
        "source": "3d-cursor",
        "center": cursor,
        "focus_radius": max(float(current_distance) * 0.12, 0.02),
        "object_radius": max(float(current_distance) * 0.35, 0.08),
        "object_names": [],
        "selected_component_count": 0,
    }


def _distances(focus: dict, context_scale: float, zoom_scale: float) -> tuple[float, float]:
    source = focus["source"]
    object_radius = max(float(focus["object_radius"]), 0.001)
    focus_radius = max(float(focus["focus_radius"]), 0.001)

    if source == "edit-selection":
        context_radius = max(object_radius * 0.60, focus_radius * 4.0, 0.04)
        zoom_radius = max(object_radius * 0.12, focus_radius * 2.5, 0.015)
    elif source == "3d-cursor":
        context_radius = object_radius
        zoom_radius = focus_radius
    else:
        context_radius = max(object_radius * 1.05, 0.04)
        zoom_radius = max(object_radius * 0.48, 0.015)

    context_distance = max(context_radius * 2.6 * context_scale, 0.03)
    zoom_distance = max(zoom_radius * 2.2 * zoom_scale, 0.015)
    if zoom_distance >= context_distance:
        zoom_distance = max(context_distance * 0.45, 0.015)
    return context_distance, zoom_distance


def create_focus_review(config: dict) -> dict:
    output_dir = Path(config["output_dir"]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = _safe_name(str(config.get("file_prefix") or "blender-focus"))
    focus_mode = str(config.get("focus_mode") or "auto")
    if focus_mode not in {"auto", "selection", "active-object", "cursor"}:
        raise ValueError(f"Unsupported focus mode: {focus_mode}")

    max_size = int(config.get("max_size", 1200))
    context_scale = float(config.get("context_scale", 1.0))
    zoom_scale = float(config.get("zoom_scale", 1.0))
    overwrite = bool(config.get("overwrite", False))

    paths = {
        "general": output_dir / f"{prefix}_general.png",
        "context": output_dir / f"{prefix}_context.png",
        "zoom": output_dir / f"{prefix}_zoom.png",
        "manifest": output_dir / f"{prefix}_focus.json",
    }
    existing = [str(item) for item in paths.values() if item.exists()]
    if existing and not overwrite:
        raise FileExistsError(f"Focus-review artifacts already exist; set overwrite=true or use a new filePrefix: {existing}")

    viewport = _viewport_context()
    _window, _screen, _area, _region, _space, region_3d = viewport
    saved = {
        "view_location": region_3d.view_location.copy(),
        "view_distance": float(region_3d.view_distance),
        "view_rotation": region_3d.view_rotation.copy(),
        "view_perspective": str(region_3d.view_perspective),
        "view_camera_zoom": float(region_3d.view_camera_zoom),
        "view_camera_offset": tuple(float(value) for value in region_3d.view_camera_offset),
    }
    before = _view_state(region_3d)
    focus = _resolve_focus(focus_mode, saved["view_distance"])
    context_distance, zoom_distance = _distances(focus, context_scale, zoom_scale)

    result = {
        "stage": "focus_review_created",
        "created_at": _utc_now(),
        "blender": {
            "version": bpy.app.version_string,
            "file": bpy.data.filepath or None,
            "scene": bpy.context.scene.name,
            "frame": bpy.context.scene.frame_current,
        },
        "request": {
            "focus_mode": focus_mode,
            "max_size": max_size,
            "context_scale": context_scale,
            "zoom_scale": zoom_scale,
        },
        "focus": {
            "source": focus["source"],
            "center": [round(float(value), 8) for value in focus["center"]],
            "focus_radius": round(float(focus["focus_radius"]), 8),
            "object_radius": round(float(focus["object_radius"]), 8),
            "object_names": focus["object_names"],
            "selected_component_count": focus["selected_component_count"],
        },
        "view_before": before,
        "distances": {
            "context": round(context_distance, 8),
            "zoom": round(zoom_distance, 8),
        },
        "captures": {},
        "restoration": {"attempted": True, "completed": False},
    }

    try:
        result["captures"]["general"] = _capture_viewport(paths["general"], max_size, viewport)

        region_3d.view_location = focus["center"]
        region_3d.view_distance = context_distance
        result["captures"]["context"] = _capture_viewport(paths["context"], max_size, viewport)

        region_3d.view_distance = zoom_distance
        result["captures"]["zoom"] = _capture_viewport(paths["zoom"], max_size, viewport)
    finally:
        region_3d.view_location = saved["view_location"]
        region_3d.view_distance = saved["view_distance"]
        region_3d.view_rotation = saved["view_rotation"]
        region_3d.view_perspective = saved["view_perspective"]
        region_3d.view_camera_zoom = saved["view_camera_zoom"]
        region_3d.view_camera_offset = saved["view_camera_offset"]
        _area.tag_redraw()
        with bpy.context.temp_override(window=_window, screen=_screen, area=_area, region=_region):
            try:
                bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
            except Exception:
                pass

    after = _view_state(region_3d)
    result["view_after"] = after
    result["restoration"]["completed"] = before == after
    paths["manifest"].write_text(json.dumps(result, indent=2), encoding="utf-8")
    result["manifest"] = {
        "path": str(paths["manifest"]),
        "bytes": paths["manifest"].stat().st_size,
        "sha256": _sha256_file(paths["manifest"]),
    }
    return result
