# Bridge project state

## Current release
Bridge `0.6.91` is live after a controlled HTTP-surface restart. The runtime reports version `0.6.91`, 149 tools, and dedicated schemas for `godot_scene_open` and `godot_scene_create`. The tools use native provider/editor operations, verify persistence/editor readback, require the already-connected intended editor, and explicitly avoid Ctrl+O, clicks, SendKeys, or implicit duplicate-editor launch. Bridge packages MSSR core `0.2.14`, and the runtime skill catalog discovers the user-owned `godot-scene-authoring` skill. Focused tests and the full Bridge regression suite pass. A GodotAtlas smoke call correctly failed closed because the currently open `Godot Atlas Demo` project does not enable `addons/godot_mcp` and the provider reports `connected=false`; no UI fallback was attempted. The remaining GodotAtlas-specific operational step is to connect/enable the MCP plugin in that project before using the new native scene tools there.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
