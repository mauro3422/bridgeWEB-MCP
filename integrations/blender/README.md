# Mauro Blender Bridge

Direct Blender control for `bridge-mcp`, without requiring Codex.

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> bridge-mcp on MauroPrime
  -> 127.0.0.1:9877
  -> Blender 5.1+
```

## Modes

### Interactive

`blender_open` launches Blender with `startup.py`. The startup script loads
`mauro_blender_bridge.py` and starts a local-only socket server.

Available interactive tools:

- `blender_status`
- `blender_open`
- `blender_scene_info`
- `blender_viewport_screenshot`
- `blender_execute_code`

The Blender sidebar also contains **Mauro Bridge**, where the local server can
be stopped or started manually.

### Batch/headless

`blender_batch_script` runs a versioned Python script through Blender with
`--background`. This is the preferred path for repeatable character cleanup,
polygon reduction, validation and GLB export.

## Configuration

Defaults:

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

## Security

- The interactive socket binds only to loopback.
- User-controlled project, script, screenshot and `.blend` paths remain under
  the normal `bridge-mcp` allowed-root policy.
- The configured Blender executable is trusted explicitly; the whole `D:`
  drive is not added to allowed roots.
- `blender_execute_code`, `blender_open`, screenshot writes and batch scripts
  are marked destructive in MCP tool annotations.
- Save important `.blend` files before large automated operations.

## Character concept loop

The image and Blender tools now form a resumable pipeline:

1. Generate one image or a batch in ChatGPT.
2. Persist the results with `image_asset_save`.
3. Build and open the four-view scene with `blender_setup_character_references`.
4. Resume or diagnose the pipeline with `blender_character_loop_status`.

`image_asset_save` accepts between one and eight PNG/JPEG/WebP items in the same call. It validates file signatures, records hashes and dimensions, writes atomically, and can create a JSON manifest containing roles, prompts, sources and arbitrary metadata.

`blender_setup_character_references` validates front, side, back and three-quarter paths, creates a `.blend` scene through the versioned `setup_character_references.py` script, writes a `.loop.json` checkpoint, opens Blender on an available local port, and verifies the socket connection before returning.
