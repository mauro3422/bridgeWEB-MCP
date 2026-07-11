import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy


def file_info(path: Path) -> dict:
    data = path.read_bytes()
    return {
        "path": str(path),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def add_reference(
    collection: bpy.types.Collection,
    name: str,
    image_path: Path,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float],
    display_size: float,
    opacity: float,
    hidden: bool = False,
) -> bpy.types.Object:
    image = bpy.data.images.load(str(image_path), check_existing=True)
    image.name = f"REF_IMAGE_{name}"

    obj = bpy.data.objects.new(f"REF_{name}", None)
    obj.empty_display_type = "IMAGE"
    obj.data = image
    obj.location = location
    obj.rotation_euler = rotation
    obj.empty_display_size = display_size
    obj.color[3] = opacity
    obj.empty_image_depth = "FRONT"
    obj.empty_image_side = "DOUBLE_SIDED"
    obj.show_in_front = True
    obj.hide_render = True
    obj["reference_role"] = name.lower()
    obj["source_path"] = str(image_path)
    collection.objects.link(obj)
    obj.hide_set(hidden)
    return obj


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--character-name", required=True)
    parser.add_argument("--front", required=True)
    parser.add_argument("--side", required=True)
    parser.add_argument("--back", required=True)
    parser.add_argument("--three-quarter", required=True)
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--height", type=float, default=6.0)
    parser.add_argument("--opacity", type=float, default=0.55)
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parser.parse_args(script_args)

    images = {
        "FRONT": Path(args.front).expanduser().resolve(),
        "SIDE": Path(args.side).expanduser().resolve(),
        "BACK": Path(args.back).expanduser().resolve(),
        "THREE_QUARTER": Path(args.three_quarter).expanduser().resolve(),
    }
    for role, image_path in images.items():
        if not image_path.is_file():
            raise FileNotFoundError(f"{role} reference not found: {image_path}")

    output_blend = Path(args.output_blend).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser().resolve()
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = args.character_name
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene["character_name"] = args.character_name
    scene["reference_manifest"] = str(manifest_path)
    scene["reference_height"] = args.height

    references = bpy.data.collections.new("REFERENCES")
    scene.collection.children.link(references)

    center_z = args.height / 2.0
    front_rotation = (math.radians(90.0), 0.0, 0.0)
    side_rotation = (math.radians(90.0), 0.0, math.radians(90.0))

    objects = {
        "front": add_reference(
            references,
            "FRONT",
            images["FRONT"],
            (0.0, 0.0, center_z),
            front_rotation,
            args.height,
            args.opacity,
        ),
        "side": add_reference(
            references,
            "SIDE",
            images["SIDE"],
            (0.0, 0.0, center_z),
            side_rotation,
            args.height,
            args.opacity,
        ),
        "back": add_reference(
            references,
            "BACK",
            images["BACK"],
            (0.0, 0.0, center_z),
            front_rotation,
            args.height,
            args.opacity,
            hidden=True,
        ),
        "three_quarter": add_reference(
            references,
            "THREE_QUARTER",
            images["THREE_QUARTER"],
            (args.height * 1.15, 0.0, center_z),
            front_rotation,
            args.height,
            args.opacity,
            hidden=True,
        ),
    }

    for obj in objects.values():
        obj.select_set(False)

    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), check_existing=False)

    manifest = {
        "schemaVersion": 1,
        "stage": "blend_created",
        "characterName": args.character_name,
        "outputBlend": str(output_blend),
        "blenderVersion": bpy.app.version_string,
        "settings": {
            "height": args.height,
            "opacity": args.opacity,
            "frontAndSideVisible": True,
            "backAndThreeQuarterHidden": True,
        },
        "images": {role.lower(): file_info(path) for role, path in images.items()},
        "objects": {role: obj.name for role, obj in objects.items()},
        "output": file_info(output_blend),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("CHARACTER_REFERENCE_SETUP=" + json.dumps(manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
