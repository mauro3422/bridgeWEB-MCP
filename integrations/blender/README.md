# Mauro Blender Bridge

Direct local Blender control for `bridge-mcp`:

```text
ChatGPT
  → OpenAI Secure MCP Tunnel
  → bridge-mcp on MauroPrime
  → 127.0.0.1:9877
  → Blender 5.1+
```

## Interactive bridge

The persistent addon starts the local-only socket server when Blender opens normally. Background and batch Blender runs register the addon without claiming the interactive port.

Interactive tools:

```text
blender_status
blender_open
blender_scene_info
blender_viewport_screenshot
blender_focus_review
blender_review_bundle
blender_execute_code
```

The Blender sidebar contains **Mauro Bridge**, where the local server can be started or stopped manually.

Install or refresh the persistent kit:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-blender-kit.ps1
```

Rollback:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-blender-kit.ps1 -Uninstall
```
## Session identity and concurrent modeling

Every live Blender operation is pinned to the exact `.blend` path, addon port and reported Blender PID. `blender_status` reports:

- connected file and exact-target match;
- dirty/saved state and disk modification time;
- last file load and save;
- last scene update and whether it came from Bridge or human/external activity;
- active object, mode and scene;
- all other Blender processes as warnings.

Additional Blender windows are never auto-closed. A port already owned by another `.blend` is a hard failure, not permission to switch that window.

Use one explicit mode:

```text
reference-only      generate/persist/prepare references on disk; never touch Blender
inspect             read exact scene state without changing it
scene-write         edit the exact expected .blend
foreground-capture  focus/reframe the exact expected Blender window for pixels
```

When Mauro says he is modeling while ChatGPT generates references, use `reference-only`. `image_reference_pack_prepare` should receive `operationMode: reference-only`, `userModeling: true`, and the intended `targetBlendFile`. The resulting manifest records deferred installation and forbids live Blender tools until a later exact-target preflight.



## Generic modeling-reference pipeline

New character and prop work should use:

```text
image_asset_save
→ image_reference_pack_prepare
→ blender_validate_reference_pack
→ blender_install_reference_pack
```

### `image_reference_pack_prepare`

Creates a persisted `blender-reference-pack` manifest from two to ten views. It supports:

- cardinal construction roles: `front`, `rear`, `left`, `right`, `top`, `bottom`;
- design roles: `front_left_3q`, `front_right_3q`, `rear_left_3q`, `rear_right_3q`;
- separate design and geometric masters;
- semantic QA status and notes per view;
- optional normalized landmarks;
- cropping and uniform scale without stretching;
- common canvas, occupancy, hashes, dimensions and opposite-pair warnings.

### `blender_validate_reference_pack`

Reads the actual persisted files and checks:

- canonical unique roles;
- cardinal construction views marked orthographic;
- semantic QA pass when required;
- signatures, dimensions, byte counts and SHA-256;
- shared construction canvas;
- duplicate cardinal images;
- required roles, masters and blocking warnings.

It is read-only. A pending or failed semantic review blocks installation by default.

### `blender_install_reference_pack`

Creates a new working `.blend` plus `<name>.reference-install.json`.

For `layout: axis_aligned`:

```text
front + rear  → shared XZ plane, FRONT/BACK visibility
left + right  → shared YZ plane, BACK/FRONT visibility
top + bottom  → shared XY plane, FRONT/BACK visibility
```

Construction Image Empties are placed behind geometry, visible only in orthographic axis-aligned views, hidden in perspective, locked from selection and excluded from render. They live in `REFERENCES_CONSTRUCTION`.

Perspective design masters live in `REFERENCES_DESIGN` and are hidden by default.

`layout: surround` offsets the cardinal images for inspection and permits perspective display. It is not the modeling default.

### Character compatibility

`image_character_views_prepare` and `blender_setup_character_references` remain available for historical front/side/back/three-quarter character packs. The setup tool now adapts those roles into the generic axis-aligned installer rather than using the old double-sided overlapping planes.

`blender_character_loop_status` reads both compatibility checkpoints and generic installed-pack paths.

## “Look where I point” review

Select an object, or enter Edit Mode and select relevant vertices, edges or faces. Use the 3D Cursor when nothing should be selected. `blender_focus_review` creates:

1. the exact current viewport for retrospective context;
2. a medium view around the indicated area;
3. a close zoom from the same viewing direction.

It restores viewport, projection, selection and mode and writes a manifest with focus source, camera state, image hashes and restoration result.

## Repeatable model photography

`blender_review_bundle` derives bounds from selected objects or collections, creates temporary orthographic cameras, renders fixed views, optionally creates a contact sheet and restores scene state. The manifest records cameras, bounds, geometry, materials, visibility, rig, animation, warnings and hashes.

## Batch/headless

`blender_batch_script` runs a versioned Python script with `--background`. Use it for repeatable cleanup, validation, polygon reduction, export and test fixtures without competing for the interactive port.

## Configuration

```text
Blender: D:\SteamLibrary\steamapps\common\Blender\blender.exe
Host:    127.0.0.1
Port:    9877
```

Optional environment variables:

```text
BRIDGE_BLENDER_EXE
BRIDGE_BLENDER_PORT
```

## Security and deliverables

- The socket binds only to loopback.
- User-controlled paths remain under Bridge allowed-root policy.
- The Blender executable is explicitly trusted; the whole drive is not opened.
- Writes, code execution, screenshots, batch scripts and reference installation are marked destructive/auditable.
- Save important `.blend` files before large automated operations.
- Keep `REFERENCES`, `REF_*` and temporary helpers in a working file. Save and reopen a distinct clean model/export file before claiming the game asset is complete.
