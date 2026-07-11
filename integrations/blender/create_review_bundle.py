from __future__ import annotations

from array import array
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Iterable

import bpy
from mathutils import Vector


VIEW_DIRECTIONS = {
    "front": Vector((0.0, -1.0, 0.0)),
    "right": Vector((1.0, 0.0, 0.0)),
    "back": Vector((0.0, 1.0, 0.0)),
    "left": Vector((-1.0, 0.0, 0.0)),
    "three-quarter": Vector((1.0, -1.0, 0.32)),
    "three-quarter-left": Vector((-1.0, -1.0, 0.32)),
    "rear-three-quarter": Vector((1.0, 1.0, 0.32)),
    "top": Vector((0.0, 0.0, 1.0)),
}
RENDERABLE_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
TEMP_COLLECTION_NAME = "__BRIDGE_REVIEW_TEMP__"
TEMP_CAMERA_NAME = "__BRIDGE_REVIEW_CAMERA__"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_name(value: str, fallback: str = "blender-review") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return cleaned[:96] or fallback


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unique_objects(items: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    seen: set[int] = set()
    result: list[bpy.types.Object] = []
    for obj in items:
        pointer = obj.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        result.append(obj)
    return result


def _collect_targets(config: dict) -> tuple[list[bpy.types.Object], list[str]]:
    warnings: list[str] = []
    requested_objects = [str(item) for item in config.get("target_objects", [])]
    requested_collections = [str(item) for item in config.get("target_collections", [])]
    explicit: list[bpy.types.Object] = []

    for name in requested_objects:
        obj = bpy.data.objects.get(name)
        if obj is None:
            warnings.append(f"Target object not found: {name}")
        else:
            explicit.append(obj)

    for name in requested_collections:
        collection = bpy.data.collections.get(name)
        if collection is None:
            warnings.append(f"Target collection not found: {name}")
        else:
            explicit.extend(collection.all_objects)

    if explicit:
        targets = [obj for obj in _unique_objects(explicit) if obj.type in RENDERABLE_TYPES]
    else:
        targets = [
            obj
            for obj in bpy.context.scene.objects
            if obj.type in RENDERABLE_TYPES and obj.visible_get()
        ]

    if not targets:
        raise RuntimeError("No renderable target objects were found for the review bundle")
    return targets, warnings


def _world_bounds(objects: list[bpy.types.Object]) -> tuple[list[Vector], Vector, Vector, Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    points: list[Vector] = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        for corner in evaluated.bound_box:
            points.append(evaluated.matrix_world @ Vector(corner))
    if not points:
        raise RuntimeError("Target objects do not expose a usable world-space bounding box")
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    center = (minimum + maximum) * 0.5
    dimensions = maximum - minimum
    return points, minimum, maximum, center, dimensions


def _mesh_diagnostics(objects: list[bpy.types.Object]) -> tuple[dict, list[dict], list[str]]:
    totals = {"objects": len(objects), "mesh_objects": 0, "vertices": 0, "edges": 0, "polygons": 0, "triangles": 0}
    details: list[dict] = []
    warnings: list[str] = []
    material_names: set[str] = set()
    non_applied_scale: list[str] = []
    negative_scale: list[str] = []
    missing_materials: list[str] = []
    ngon_objects: list[str] = []

    for obj in objects:
        item = {
            "name": obj.name,
            "type": obj.type,
            "location": [round(float(value), 6) for value in obj.location],
            "rotation_euler": [round(float(value), 6) for value in obj.rotation_euler],
            "scale": [round(float(value), 6) for value in obj.scale],
            "visible": bool(obj.visible_get()),
            "hide_viewport": bool(obj.hide_viewport),
            "hide_render": bool(obj.hide_render),
            "parent": obj.parent.name if obj.parent else None,
            "parent_type": obj.parent_type,
            "parent_bone": obj.parent_bone or None,
            "modifiers": [modifier.type for modifier in obj.modifiers],
        }
        if any(abs(float(value) - 1.0) > 1e-4 for value in obj.scale):
            non_applied_scale.append(obj.name)
        if any(float(value) < 0.0 for value in obj.scale):
            negative_scale.append(obj.name)

        if obj.type == "MESH" and obj.data is not None:
            mesh = obj.data
            triangles = sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)
            ngons = sum(1 for polygon in mesh.polygons if len(polygon.vertices) > 4)
            materials = [slot.material.name for slot in obj.material_slots if slot.material]
            material_names.update(materials)
            if not materials:
                missing_materials.append(obj.name)
            if ngons:
                ngon_objects.append(obj.name)
            item["mesh"] = {
                "vertices": len(mesh.vertices),
                "edges": len(mesh.edges),
                "polygons": len(mesh.polygons),
                "triangles": triangles,
                "ngons": ngons,
                "materials": materials,
            }
            totals["mesh_objects"] += 1
            totals["vertices"] += len(mesh.vertices)
            totals["edges"] += len(mesh.edges)
            totals["polygons"] += len(mesh.polygons)
            totals["triangles"] += triangles
        details.append(item)

    if non_applied_scale:
        warnings.append(f"{len(non_applied_scale)} target object(s) have non-unit scale")
    if negative_scale:
        warnings.append(f"{len(negative_scale)} target object(s) have negative scale")
    if missing_materials:
        warnings.append(f"{len(missing_materials)} mesh object(s) have no material")
    if ngon_objects:
        warnings.append(f"{len(ngon_objects)} mesh object(s) contain n-gons")

    diagnostics = {
        "totals": totals,
        "materials": sorted(material_names),
        "non_applied_scale": non_applied_scale,
        "negative_scale": negative_scale,
        "missing_materials": missing_materials,
        "ngon_objects": ngon_objects,
    }
    return diagnostics, details, warnings


def _rig_context(targets: list[bpy.types.Object]) -> dict:
    target_set = set(targets)
    armatures: list[dict] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE" or obj.data is None:
            continue
        related = 0
        for target in targets:
            parent = target
            while parent is not None:
                if parent == obj:
                    related += 1
                    break
                parent = parent.parent
            if any(modifier.type == "ARMATURE" and modifier.object == obj for modifier in target.modifiers):
                related += 1
        active_action = None
        if obj.animation_data and obj.animation_data.action:
            active_action = obj.animation_data.action.name
        armatures.append({
            "name": obj.name,
            "bones": len(obj.data.bones),
            "bone_names": [bone.name for bone in obj.data.bones][:250],
            "visible": bool(obj.visible_get()),
            "hide_viewport": bool(obj.hide_viewport),
            "hide_render": bool(obj.hide_render),
            "active_action": active_action,
            "related_target_links": related,
        })

    actions = []
    for action in bpy.data.actions:
        frame_range = [round(float(value), 4) for value in action.frame_range]
        actions.append({"name": action.name, "frame_range": frame_range, "users": int(action.users)})

    return {
        "armatures": armatures,
        "actions": actions,
        "target_object_count": len(target_set),
    }


def _collection_context() -> list[dict]:
    return [
        {
            "name": collection.name,
            "objects": len(collection.objects),
            "all_objects": len(collection.all_objects),
            "hide_viewport": bool(collection.hide_viewport),
            "hide_render": bool(collection.hide_render),
        }
        for collection in bpy.data.collections
    ]


def _configure_camera(camera: bpy.types.Object, center: Vector, points: list[Vector], view_name: str, margin: float) -> None:
    offset = VIEW_DIRECTIONS[view_name].normalized()
    span = max(max((point - center).length for point in points), 0.1)
    camera.location = center + offset * max(span * 4.0, 2.0)
    forward = (center - camera.location).normalized()
    camera.rotation_euler = forward.to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    rotation = camera.matrix_world.to_quaternion()
    right = rotation @ Vector((1.0, 0.0, 0.0))
    up = rotation @ Vector((0.0, 1.0, 0.0))
    half_width = max(abs((point - center).dot(right)) for point in points)
    half_height = max(abs((point - center).dot(up)) for point in points)
    vertical_size = max(half_height * 2.0, half_width * 2.0) * margin
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(vertical_size, 0.1)
    camera.data.clip_start = 0.01
    camera.data.clip_end = max(span * 20.0, 100.0)


def _make_contact_sheet(paths: list[Path], output_path: Path, cell_size: int = 320, padding: int = 8) -> dict:
    if not paths:
        raise RuntimeError("Cannot create a contact sheet without rendered views")
    columns = min(3, max(1, math.ceil(math.sqrt(len(paths)))))
    rows = math.ceil(len(paths) / columns)
    width = columns * cell_size + (columns + 1) * padding
    height = rows * cell_size + (rows + 1) * padding
    background = array("f", [0.025, 0.03, 0.04, 1.0]) * (width * height)

    loaded_images: list[bpy.types.Image] = []
    try:
        for index, image_path in enumerate(paths):
            image = bpy.data.images.load(str(image_path), check_existing=False)
            loaded_images.append(image)
            image.scale(cell_size, cell_size)
            source = array("f", image.pixels[:])
            column = index % columns
            row = index // columns
            x_offset = padding + column * (cell_size + padding)
            y_offset = height - padding - (row + 1) * cell_size - row * padding
            stride = cell_size * 4
            for y in range(cell_size):
                source_start = y * stride
                destination_start = ((y_offset + y) * width + x_offset) * 4
                background[destination_start:destination_start + stride] = source[source_start:source_start + stride]

        sheet = bpy.data.images.new("__BRIDGE_REVIEW_CONTACT__", width=width, height=height, alpha=True, float_buffer=False)
        try:
            sheet.pixels.foreach_set(background)
            sheet.filepath_raw = str(output_path)
            sheet.file_format = "PNG"
            sheet.save()
        finally:
            bpy.data.images.remove(sheet)
    finally:
        for image in loaded_images:
            if image.name in bpy.data.images:
                bpy.data.images.remove(image)

    return {
        "path": str(output_path),
        "width": width,
        "height": height,
        "bytes": output_path.stat().st_size,
        "sha256": _sha256_file(output_path),
    }


def create_review_bundle(config: dict) -> dict:
    scene = bpy.context.scene
    output_dir = Path(config["output_dir"]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = _safe_name(str(config.get("file_prefix") or "blender-review"))
    views = [str(item) for item in config.get("views", ["front", "right", "back", "three-quarter"])]
    invalid_views = [name for name in views if name not in VIEW_DIRECTIONS]
    if invalid_views:
        raise ValueError(f"Unsupported review views: {invalid_views}")
    if not views:
        raise ValueError("At least one review view is required")

    resolution = int(config.get("resolution", 800))
    margin = float(config.get("margin", 1.18))
    transparent = bool(config.get("transparent_background", False))
    create_contact = bool(config.get("create_contact_sheet", True))
    overwrite = bool(config.get("overwrite", False))

    targets, warnings = _collect_targets(config)
    points, minimum, maximum, center, dimensions = _world_bounds(targets)
    geometry, object_details, geometry_warnings = _mesh_diagnostics(targets)
    warnings.extend(geometry_warnings)
    rig = _rig_context(targets)
    if not rig["armatures"]:
        warnings.append("No armature was found in the scene")
    if not rig["actions"]:
        warnings.append("No animation actions were found in the scene")

    visible_reference_images = [
        obj.name for obj in scene.objects
        if obj.type == "EMPTY" and getattr(obj, "empty_display_type", None) == "IMAGE" and obj.visible_get()
    ]
    if visible_reference_images:
        warnings.append(f"{len(visible_reference_images)} visible image reference(s) may obscure normal viewport review")

    artifact_paths = [output_dir / f"{prefix}_{view}.png" for view in views]
    contact_path = output_dir / f"{prefix}_contact.png"
    manifest_path = output_dir / f"{prefix}_review.json"
    requested_paths = artifact_paths + ([contact_path] if create_contact else []) + [manifest_path]
    existing = [str(item) for item in requested_paths if item.exists()]
    if existing and not overwrite:
        raise FileExistsError(f"Review artifacts already exist; set overwrite=true or use a new filePrefix: {existing}")

    saved_scene = {
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
    selected_before = [obj.name for obj in bpy.context.selected_objects]
    active_before = bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None

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
    for target in targets:
        if target.name not in temporary_collection.objects:
            temporary_collection.objects.link(target)

    rendered: list[dict] = []
    try:
        for obj in scene.objects:
            obj.hide_render = obj not in targets
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

        shading = scene.display.shading
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

        for view_name, output_path in zip(views, artifact_paths):
            _configure_camera(camera, center, points, view_name, margin)
            scene.render.filepath = str(output_path)
            bpy.context.view_layer.update()
            bpy.ops.render.render(write_still=True)
            if not output_path.exists():
                raise RuntimeError(f"Blender did not produce the expected review render: {output_path}")
            rendered.append({
                "view": view_name,
                "path": str(output_path),
                "width": resolution,
                "height": resolution,
                "bytes": output_path.stat().st_size,
                "sha256": _sha256_file(output_path),
                "camera_location": [round(float(value), 6) for value in camera.location],
                "camera_rotation_euler": [round(float(value), 6) for value in camera.rotation_euler],
                "projection": "orthographic",
                "ortho_scale": round(float(camera.data.ortho_scale), 6),
            })

        contact = _make_contact_sheet(artifact_paths, contact_path) if create_contact else None
        result = {
            "stage": "review_bundle_created",
            "created_at": _utc_now(),
            "blender": {
                "version": bpy.app.version_string,
                "file": bpy.data.filepath or None,
                "scene": scene.name,
                "frame": scene.frame_current,
            },
            "request": {
                "views": views,
                "resolution": resolution,
                "margin": margin,
                "transparent_background": transparent,
                "target_collections": list(config.get("target_collections", [])),
                "target_objects": list(config.get("target_objects", [])),
            },
            "bounds": {
                "minimum": [round(float(value), 6) for value in minimum],
                "maximum": [round(float(value), 6) for value in maximum],
                "center": [round(float(value), 6) for value in center],
                "dimensions": [round(float(value), 6) for value in dimensions],
            },
            "geometry": geometry,
            "objects": object_details,
            "rig": rig,
            "collections": _collection_context(),
            "visibility": {
                "selected_before": selected_before,
                "active_before": active_before,
                "visible_reference_images": visible_reference_images,
            },
            "warnings": warnings,
            "renders": rendered,
            "contact_sheet": contact,
            "restoration": {"attempted": True, "completed": False},
        }
        manifest_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        result["manifest"] = {
            "path": str(manifest_path),
            "bytes": manifest_path.stat().st_size,
            "sha256": _sha256_file(manifest_path),
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
        bpy.ops.object.select_all(action="DESELECT")
        for name in selected_before:
            obj = bpy.data.objects.get(name)
            if obj is not None and obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if active_before:
            active = bpy.data.objects.get(active_before)
            if active is not None and active.name in bpy.context.view_layer.objects:
                bpy.context.view_layer.objects.active = active
        bpy.context.view_layer.update()
        if "result" in locals():
            result["restoration"]["completed"] = True
            manifest_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
            result["manifest"] = {
                "path": str(manifest_path),
                "bytes": manifest_path.stat().st_size,
                "sha256": _sha256_file(manifest_path),
            }
