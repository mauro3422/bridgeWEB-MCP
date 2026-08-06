import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

CONSTRUCTION_ROLES = {"front", "rear", "left", "right", "top", "bottom"}
ROLE_LAYOUT = {
    "front": {
        "plane": "XZ",
        "rotation": (math.radians(90.0), 0.0, 0.0),
        "side": "FRONT",
    },
    "rear": {
        "plane": "XZ",
        "rotation": (math.radians(90.0), 0.0, 0.0),
        "side": "BACK",
    },
    "right": {
        "plane": "YZ",
        "rotation": (math.radians(90.0), 0.0, math.radians(90.0)),
        "side": "FRONT",
    },
    "left": {
        "plane": "YZ",
        "rotation": (math.radians(90.0), 0.0, math.radians(90.0)),
        "side": "BACK",
    },
    "top": {
        "plane": "XY",
        "rotation": (0.0, 0.0, 0.0),
        "side": "FRONT",
    },
    "bottom": {
        "plane": "XY",
        "rotation": (0.0, 0.0, 0.0),
        "side": "BACK",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_info(path: Path) -> dict:
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def set_if_supported(obj: bpy.types.Object, name: str, value) -> bool:
    if not hasattr(obj, name):
        return False
    setattr(obj, name, value)
    return True


def reference_location(role: str, display_size: float, alignment: str) -> tuple[float, float, float]:
    center = display_size / 2.0
    if role in {"top", "bottom"}:
        return (0.0, 0.0, 0.0)
    if alignment == "baseline":
        return (0.0, 0.0, center)
    return (0.0, 0.0, 0.0)


def add_image_empty(
    collection: bpy.types.Collection,
    item: dict,
    display_size: float,
    opacity: float,
    alignment: str,
    layout_mode: str,
    hidden: bool,
    design_index: int,
) -> tuple[bpy.types.Object, dict]:
    role = item["role"]
    image_path = Path(item["output"]["path"]).expanduser().resolve()
    if not image_path.is_file():
        raise FileNotFoundError(f"Reference image not found for {role}: {image_path}")
    image = bpy.data.images.load(str(image_path), check_existing=True)
    image.name = f"REF_IMAGE_{role.upper()}"

    obj = bpy.data.objects.new(f"REF_{role.upper()}", None)
    obj.empty_display_type = "IMAGE"
    obj.data = image
    obj.empty_display_size = display_size
    obj.color[3] = opacity
    obj.hide_render = True
    obj.hide_select = True
    obj.show_in_front = False
    obj["reference_role"] = role
    obj["reference_usage"] = item.get("usage", "construction")
    obj["reference_projection"] = item.get("projection", "orthographic")
    obj["source_path"] = str(image_path)
    obj["source_sha256"] = item["output"].get("sha256", "")

    is_construction = role in CONSTRUCTION_ROLES and item.get("usage") == "construction"
    supported = {}
    if is_construction:
        layout = ROLE_LAYOUT[role]
        obj.rotation_euler = layout["rotation"]
        obj.empty_image_depth = "BACK"
        obj["reference_plane"] = layout["plane"]
        if layout_mode == "surround":
            distance = display_size * 0.8
            center = display_size / 2.0 if alignment == "baseline" else 0.0
            surround_locations = {
                "front": (0.0, -distance, center),
                "rear": (0.0, distance, center),
                "right": (distance, 0.0, center),
                "left": (-distance, 0.0, center),
                "top": (0.0, 0.0, distance),
                "bottom": (0.0, 0.0, -distance),
            }
            obj.location = surround_locations[role]
            obj.empty_image_side = "DOUBLE_SIDED"
            supported["axisAlignedOnly"] = set_if_supported(obj, "show_empty_image_only_axis_aligned", False)
            supported["orthographicVisible"] = set_if_supported(obj, "show_empty_image_orthographic", True)
            supported["perspectiveVisible"] = set_if_supported(obj, "show_empty_image_perspective", True)
        else:
            obj.location = reference_location(role, display_size, alignment)
            obj.empty_image_side = layout["side"]
            supported["axisAlignedOnly"] = set_if_supported(obj, "show_empty_image_only_axis_aligned", True)
            supported["orthographicVisible"] = set_if_supported(obj, "show_empty_image_orthographic", True)
            supported["perspectiveHidden"] = set_if_supported(obj, "show_empty_image_perspective", False)
    else:
        obj.location = (display_size * (1.25 + design_index * 0.18), 0.0, display_size / 2.0)
        obj.rotation_euler = ROLE_LAYOUT["front"]["rotation"]
        obj.empty_image_depth = "BACK"
        obj.empty_image_side = "DOUBLE_SIDED"
        supported["axisAlignedOnly"] = set_if_supported(obj, "show_empty_image_only_axis_aligned", False)
        supported["orthographicVisible"] = set_if_supported(obj, "show_empty_image_orthographic", True)
        supported["perspectiveVisible"] = set_if_supported(obj, "show_empty_image_perspective", True)
        obj["reference_plane"] = "DESIGN"

    collection.objects.link(obj)
    obj.hide_set(hidden)
    return obj, supported


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parser.parse_args(script_args)

    config_path = Path(args.config).expanduser().resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    manifest_path = Path(config["manifestPath"]).expanduser().resolve()
    output_blend = Path(config["outputBlend"]).expanduser().resolve()
    install_manifest_path = Path(config["installManifestPath"]).expanduser().resolve()
    pack = json.loads(manifest_path.read_text(encoding="utf-8"))

    if pack.get("kind") != "blender-reference-pack":
        raise ValueError("Expected a blender-reference-pack manifest")

    display_size = float(config.get("displaySize", 2.0))
    opacity = float(config.get("opacity", 0.45))
    layout_mode = config.get("layout", "axis_aligned")
    alignment = pack.get("settings", {}).get("alignment") or "center"

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    install_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = pack.get("baseName", "ReferencePack")
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene["reference_pack_manifest"] = str(manifest_path)
    scene["reference_pack_layout"] = layout_mode
    scene["reference_display_size"] = display_size

    references = bpy.data.collections.new("REFERENCES")
    construction = bpy.data.collections.new("REFERENCES_CONSTRUCTION")
    design = bpy.data.collections.new("REFERENCES_DESIGN")
    scene.collection.children.link(references)
    references.children.link(construction)
    references.children.link(design)

    installed = []
    design_index = 0
    for item in pack.get("items", []):
        role = item["role"]
        is_construction = role in CONSTRUCTION_ROLES and item.get("usage") == "construction"
        target_collection = construction if is_construction else design
        hidden = False if is_construction else True
        if layout_mode == "surround" and is_construction:
            # Surround is inspection-only. Keep image semantics but offset planes so all
            # references can be examined together without claiming geometric alignment.
            hidden = False
        obj, supported = add_image_empty(
            target_collection,
            item,
            display_size,
            opacity,
            alignment,
            layout_mode,
            hidden,
            design_index,
        )
        if not is_construction:
            design_index += 1
        installed.append(
            {
                "role": role,
                "object": obj.name,
                "collection": target_collection.name,
                "usage": item.get("usage"),
                "projection": item.get("projection"),
                "location": [round(value, 6) for value in obj.location],
                "rotationEuler": [round(value, 6) for value in obj.rotation_euler],
                "displaySize": obj.empty_display_size,
                "imageDepth": obj.empty_image_depth,
                "imageSide": obj.empty_image_side,
                "hideSelect": obj.hide_select,
                "hideRender": obj.hide_render,
                "showInFront": obj.show_in_front,
                "hidden": hidden,
                "supportedProperties": supported,
            }
        )

    for obj in scene.objects:
        obj.select_set(False)

    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), check_existing=False)
    install_manifest = {
        "schemaVersion": 1,
        "kind": "blender-reference-install",
        "stage": "blend_created",
        "sourceManifest": file_info(manifest_path),
        "outputBlend": file_info(output_blend),
        "blenderVersion": bpy.app.version_string,
        "settings": {
            "layout": layout_mode,
            "displaySize": display_size,
            "opacity": opacity,
            "alignment": alignment,
            "constructionCollection": construction.name,
            "designCollection": design.name,
        },
        "objects": installed,
    }
    install_manifest_path.write_text(json.dumps(install_manifest, indent=2), encoding="utf-8")
    print("REFERENCE_PACK_INSTALLED=" + json.dumps(install_manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
