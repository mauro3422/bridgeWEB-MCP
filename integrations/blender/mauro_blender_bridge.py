bl_info = {
    "name": "Mauro Blender Bridge",
    "author": "MauroPrime",
    "version": (0, 3, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Mauro Bridge",
    "description": "Local-only bridge used by bridge-mcp to inspect and automate Blender",
    "category": "Development",
}

import io
import json
import os
import socket
import threading
import time
import traceback
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

import bpy
from bpy.app.handlers import persistent


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9877
MAX_REQUEST_BYTES = 2 * 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 180


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _file_disk_state():
    filepath = bpy.data.filepath or None
    if not filepath:
        return {"exists": False, "modified_at": None, "bytes": None}
    try:
        stat = Path(filepath).stat()
        return {
            "exists": True,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
            "bytes": stat.st_size,
        }
    except OSError:
        return {"exists": False, "modified_at": None, "bytes": None}


_ACTIVITY = {
    "runtime_started_at": _utc_now(),
    "last_command_at": None,
    "last_command_type": None,
    "active_command_type": None,
    "last_file_load_at": None,
    "last_file_save_at": None,
    "last_scene_update_at": None,
    "last_scene_update_source": None,
    "last_human_or_external_update_at": None,
    "last_bridge_scene_update_at": None,
}

_BRIDGE_MUTATION_GRACE_UNTIL = 0.0


def _runtime_status():
    active = bpy.context.view_layer.objects.active if bpy.context.view_layer else None
    return {
        "pid": os.getpid(),
        "file": bpy.data.filepath or None,
        "is_saved": bool(bpy.data.filepath),
        "is_dirty": bool(bpy.data.is_dirty),
        "disk": _file_disk_state(),
        "scene": bpy.context.scene.name if bpy.context.scene else None,
        "mode": bpy.context.mode if bpy.context else None,
        "active_object": active.name if active else None,
        "activity": dict(_ACTIVITY),
    }


@persistent
def _on_load_post(_unused):
    now = _utc_now()
    _ACTIVITY["last_file_load_at"] = now
    _ACTIVITY["last_scene_update_at"] = now
    _ACTIVITY["last_scene_update_source"] = "file-load"


@persistent
def _on_save_post(_unused):
    _ACTIVITY["last_file_save_at"] = _utc_now()


@persistent
def _on_depsgraph_update_post(_scene, _depsgraph):
    now = _utc_now()
    bridge_owned = _ACTIVITY.get("active_command_type") == "execute_code" or time.monotonic() <= _BRIDGE_MUTATION_GRACE_UNTIL
    source = "bridge" if bridge_owned else "human-or-external"
    _ACTIVITY["last_scene_update_at"] = now
    _ACTIVITY["last_scene_update_source"] = source
    if source == "bridge":
        _ACTIVITY["last_bridge_scene_update_at"] = now
    else:
        _ACTIVITY["last_human_or_external_update_at"] = now


def _register_activity_handlers():
    for handlers, callback in (
        (bpy.app.handlers.load_post, _on_load_post),
        (bpy.app.handlers.save_post, _on_save_post),
        (bpy.app.handlers.depsgraph_update_post, _on_depsgraph_update_post),
    ):
        if callback not in handlers:
            handlers.append(callback)


def _unregister_activity_handlers():
    for handlers, callback in (
        (bpy.app.handlers.load_post, _on_load_post),
        (bpy.app.handlers.save_post, _on_save_post),
        (bpy.app.handlers.depsgraph_update_post, _on_depsgraph_update_post),
    ):
        if callback in handlers:
            handlers.remove(callback)


def _json_safe(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    try:
        return list(value)
    except TypeError:
        return repr(value)


def _mesh_stats(obj):
    if obj.type != "MESH" or obj.data is None:
        return None
    mesh = obj.data
    triangles = sum(max(0, len(poly.vertices) - 2) for poly in mesh.polygons)
    return {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "triangles": triangles,
        "materials": [slot.material.name for slot in obj.material_slots if slot.material],
    }


def _scene_info(object_limit=100):
    scene = bpy.context.scene
    objects = []
    total_vertices = 0
    total_triangles = 0

    for index, obj in enumerate(scene.objects):
        stats = _mesh_stats(obj)
        if stats:
            total_vertices += stats["vertices"]
            total_triangles += stats["triangles"]
        if index >= object_limit:
            continue
        item = {
            "name": obj.name,
            "type": obj.type,
            "location": [round(float(v), 5) for v in obj.location],
            "rotation_euler": [round(float(v), 5) for v in obj.rotation_euler],
            "scale": [round(float(v), 5) for v in obj.scale],
            "visible": bool(obj.visible_get()),
            "selected": bool(obj.select_get()),
        }
        if stats:
            item["mesh"] = stats
        if obj.type == "ARMATURE" and obj.data is not None:
            item["bones"] = len(obj.data.bones)
        objects.append(item)

    active = bpy.context.view_layer.objects.active
    return {
        "bridge": {"name": "mauro-blender-bridge", "version": "0.3.0"},
        "runtime": _runtime_status(),
        "blender_version": bpy.app.version_string,
        "file": bpy.data.filepath or None,
        "scene": scene.name,
        "frame": scene.frame_current,
        "object_count": len(scene.objects),
        "objects_returned": len(objects),
        "objects_truncated": len(scene.objects) > object_limit,
        "active_object": active.name if active else None,
        "selected_objects": [obj.name for obj in bpy.context.selected_objects],
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "actions": [action.name for action in bpy.data.actions],
        "totals": {
            "mesh_vertices": total_vertices,
            "mesh_triangles": total_triangles,
        },
        "objects": objects,
    }


def _viewport_context():
    window = bpy.context.window
    screen = window.screen if window else None
    if screen is None:
        raise RuntimeError("No Blender window/screen is available")

    area = next((candidate for candidate in screen.areas if candidate.type == "VIEW_3D"), None)
    if area is None:
        raise RuntimeError("No VIEW_3D area is available")
    region = next((candidate for candidate in area.regions if candidate.type == "WINDOW"), None)
    if region is None:
        raise RuntimeError("No VIEW_3D window region is available")
    space = next((candidate for candidate in area.spaces if candidate.type == "VIEW_3D"), None)
    if space is None:
        raise RuntimeError("No VIEW_3D space is available")
    return window, screen, area, region, space


def _viewport_capture_context():
    window, _screen, area, region, space = _viewport_context()
    region_3d = space.region_3d
    area.tag_redraw()
    return {
        "pid": os.getpid(),
        "file": bpy.data.filepath or None,
        "window": {
            "width": int(window.width),
            "height": int(window.height),
        },
        "area": {
            "x": int(area.x),
            "y": int(area.y),
            "width": int(area.width),
            "height": int(area.height),
        },
        "region": {
            "x": int(region.x),
            "y": int(region.y),
            "width": int(region.width),
            "height": int(region.height),
        },
        "viewport": {
            "perspective": region_3d.view_perspective,
            "rotation": [float(value) for value in region_3d.view_rotation],
            "location": [float(value) for value in region_3d.view_location],
            "distance": float(region_3d.view_distance),
        },
        "capture_contract": {
            "backend": "exact-window-client-region",
            "requires_foreground": True,
            "freshness": "window-focus-and-settle-required",
        },
    }

def _execute_code(code):
    capture = io.StringIO()
    namespace = {
        "bpy": bpy,
        "json": json,
        "Path": Path,
        "result": None,
    }
    with redirect_stdout(capture):
        exec(compile(code, "<bridge-mcp>", "exec"), namespace, namespace)
    return {
        "executed": True,
        "stdout": capture.getvalue(),
        "result": _json_safe(namespace.get("result")),
    }


class MauroBlenderBridgeServer:
    def __init__(self, host=DEFAULT_HOST, port=DEFAULT_PORT):
        self.host = host
        self.port = port
        self.running = False
        self._socket = None
        self._thread = None

    def start(self):
        if self.running:
            return
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((self.host, self.port))
        server.listen(4)
        server.settimeout(1.0)
        self._socket = server
        self.running = True
        self._thread = threading.Thread(target=self._serve, name="MauroBlenderBridge", daemon=True)
        self._thread.start()
        print(f"Mauro Blender Bridge listening on {self.host}:{self.port}")

    def stop(self):
        self.running = False
        if self._socket:
            try:
                self._socket.close()
            except OSError:
                pass
        self._socket = None
        self._thread = None
        print("Mauro Blender Bridge stopped")

    def _serve(self):
        while self.running and self._socket:
            try:
                client, _address = self._socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle_client, args=(client,), daemon=True).start()

    def _handle_client(self, client):
        client.settimeout(COMMAND_TIMEOUT_SECONDS)
        buffer = bytearray()
        try:
            command = None
            while len(buffer) <= MAX_REQUEST_BYTES:
                chunk = client.recv(8192)
                if not chunk:
                    break
                buffer.extend(chunk)
                try:
                    command = json.loads(buffer.decode("utf-8"))
                    break
                except json.JSONDecodeError:
                    continue

            if command is None:
                raise ValueError("Invalid, incomplete, or oversized JSON request")

            done = threading.Event()
            holder = {}

            def run_on_main_thread():
                try:
                    holder["response"] = self._dispatch(command)
                except Exception as exc:
                    traceback.print_exc()
                    holder["response"] = {"status": "error", "message": str(exc)}
                finally:
                    done.set()
                return None

            bpy.app.timers.register(run_on_main_thread, first_interval=0.0)
            if not done.wait(COMMAND_TIMEOUT_SECONDS):
                raise TimeoutError("Timed out waiting for Blender main thread")
            client.sendall(json.dumps(holder["response"]).encode("utf-8"))
        except Exception as exc:
            try:
                client.sendall(json.dumps({"status": "error", "message": str(exc)}).encode("utf-8"))
            except OSError:
                pass
        finally:
            try:
                client.close()
            except OSError:
                pass

    def _dispatch(self, command):
        global _BRIDGE_MUTATION_GRACE_UNTIL
        command_type = command.get("type")
        params = command.get("params") or {}
        _ACTIVITY["last_command_at"] = _utc_now()
        _ACTIVITY["last_command_type"] = command_type
        _ACTIVITY["active_command_type"] = command_type
        try:
            if command_type == "ping":
                result = {
                    "ok": True,
                    "bridge": "mauro-blender-bridge",
                    "version": "0.3.0",
                    "blender_version": bpy.app.version_string,
                    "file": bpy.data.filepath or None,
                    "runtime": _runtime_status(),
                }
            elif command_type == "get_scene_info":
                result = _scene_info(int(params.get("object_limit", 100)))
            elif command_type == "get_viewport_capture_context":
                result = _viewport_capture_context()
                result["runtime"] = _runtime_status()
            elif command_type == "get_viewport_screenshot":
                raise RuntimeError(
                    "Direct Blender framebuffer screenshots are freshness-unsafe; use Bridge exact-window viewport capture."
                )
            elif command_type == "execute_code":
                _BRIDGE_MUTATION_GRACE_UNTIL = time.monotonic() + 2.0
                result = _execute_code(str(params.get("code", "")))
                result["runtime"] = _runtime_status()
            else:
                return {"status": "error", "message": f"Unknown command: {command_type}"}
            return {"status": "success", "result": result}
        finally:
            _ACTIVITY["active_command_type"] = None


class MAUROBRIDGE_OT_StartServer(bpy.types.Operator):
    bl_idname = "mauro_bridge.start_server"
    bl_label = "Start local bridge"
    bl_description = "Allow bridge-mcp to control this Blender instance on localhost"

    def execute(self, context):
        server = getattr(bpy.types, "mauro_bridge_server", None)
        if server and server.running:
            self.report({"INFO"}, "Bridge is already running")
            return {"FINISHED"}
        try:
            server = MauroBlenderBridgeServer(port=context.scene.mauro_bridge_port)
            server.start()
            bpy.types.mauro_bridge_server = server
            context.scene.mauro_bridge_running = True
            return {"FINISHED"}
        except Exception as exc:
            context.scene.mauro_bridge_running = False
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class MAUROBRIDGE_OT_StopServer(bpy.types.Operator):
    bl_idname = "mauro_bridge.stop_server"
    bl_label = "Stop local bridge"

    def execute(self, context):
        server = getattr(bpy.types, "mauro_bridge_server", None)
        if server:
            server.stop()
        bpy.types.mauro_bridge_server = None
        context.scene.mauro_bridge_running = False
        return {"FINISHED"}


class MAUROBRIDGE_PT_Panel(bpy.types.Panel):
    bl_label = "Mauro Bridge"
    bl_idname = "MAUROBRIDGE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Mauro Bridge"

    def draw(self, context):
        layout = self.layout
        layout.prop(context.scene, "mauro_bridge_port")
        server = getattr(bpy.types, "mauro_bridge_server", None)
        running = bool(server and server.running)
        if running:
            layout.label(text=f"Connected on 127.0.0.1:{server.port}", icon="LINKED")
            layout.operator("mauro_bridge.stop_server", icon="CANCEL")
        else:
            layout.label(text="Bridge disconnected", icon="UNLINKED")
            layout.operator("mauro_bridge.start_server", icon="PLAY")
        layout.separator()
        layout.label(text="Point with selection or 3D Cursor", icon="RESTRICT_SELECT_OFF")
        layout.label(text="Then ask: mira donde apunto", icon="VIEWZOOM")


_CLASSES = (
    MAUROBRIDGE_OT_StartServer,
    MAUROBRIDGE_OT_StopServer,
    MAUROBRIDGE_PT_Panel,
)


def _auto_start_server():
    if bpy.app.background:
        return None
    scene = bpy.context.scene
    if scene is None or not hasattr(scene, "mauro_bridge_port"):
        return 0.5
    server = getattr(bpy.types, "mauro_bridge_server", None)
    if server and server.running:
        scene.mauro_bridge_running = True
        return None
    try:
        port = int(os.environ.get("BRIDGE_BLENDER_PORT", scene.mauro_bridge_port or DEFAULT_PORT))
        scene.mauro_bridge_port = port
        server = MauroBlenderBridgeServer(port=port)
        server.start()
        bpy.types.mauro_bridge_server = server
        scene.mauro_bridge_running = True
        print(f"Mauro Blender Bridge autostart complete on 127.0.0.1:{port}")
    except OSError as exc:
        scene.mauro_bridge_running = False
        print(f"Mauro Blender Bridge autostart could not bind: {exc!r}")
    except Exception as exc:
        scene.mauro_bridge_running = False
        traceback.print_exc()
        print(f"Mauro Blender Bridge autostart failed: {exc!r}")
    return None



def register():
    for cls in _CLASSES:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            pass
    bpy.types.Scene.mauro_bridge_port = bpy.props.IntProperty(
        name="Port",
        default=DEFAULT_PORT,
        min=1024,
        max=65535,
    )
    bpy.types.Scene.mauro_bridge_running = bpy.props.BoolProperty(default=False)
    _register_activity_handlers()
    if _ACTIVITY["last_file_load_at"] is None:
        _on_load_post(None)
    if not bpy.app.background and not bpy.app.timers.is_registered(_auto_start_server):
        bpy.app.timers.register(_auto_start_server, first_interval=0.5, persistent=True)


def unregister():
    _unregister_activity_handlers()
    if bpy.app.timers.is_registered(_auto_start_server):
        bpy.app.timers.unregister(_auto_start_server)
    server = getattr(bpy.types, "mauro_bridge_server", None)
    if server:
        server.stop()
    bpy.types.mauro_bridge_server = None
    for attr in ("mauro_bridge_port", "mauro_bridge_running"):
        if hasattr(bpy.types.Scene, attr):
            delattr(bpy.types.Scene, attr)
    for cls in reversed(_CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass


if __name__ == "__main__":
    register()
