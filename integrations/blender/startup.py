import importlib.util
import os
import sys
from pathlib import Path

import bpy

addon_path = Path(__file__).with_name("mauro_blender_bridge.py")
module_name = "mauro_blender_bridge_runtime"

existing = sys.modules.get(module_name)
if existing and hasattr(existing, "unregister"):
    try:
        existing.unregister()
    except Exception:
        pass

spec = importlib.util.spec_from_file_location(module_name, addon_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load Blender bridge addon: {addon_path}")

module = importlib.util.module_from_spec(spec)
sys.modules[module_name] = module
spec.loader.exec_module(module)
module.register()

port = int(os.environ.get("BRIDGE_BLENDER_PORT", "9877"))
bpy.context.scene.mauro_bridge_port = port
result = bpy.ops.mauro_bridge.start_server()
if "FINISHED" not in result:
    raise RuntimeError(f"Could not start Mauro Blender Bridge on port {port}: {result}")

bpy.types.mauro_bridge_runtime_module = module
print(f"Mauro Blender Bridge startup complete on 127.0.0.1:{port}")
