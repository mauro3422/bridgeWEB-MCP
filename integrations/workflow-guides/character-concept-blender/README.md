# Character Pipeline

This folder contains the reusable workflow for turning an AI-generated character concept into consistent Blender reference planes.

## Tools

- `image_asset_save`: saves one generated image or an atomic batch, validates the file signature, records dimensions and hashes, and optionally writes a generation manifest.
- `image_character_views_prepare`: normalizes a complete front/side/back/three-quarter set, aligns the subject, exports lightweight references, and writes quality warnings.
- `blender_setup_character_references`: creates the `.blend`, writes a resumable loop manifest, opens Blender, and verifies the local socket connection.
- `blender_character_loop_status`: reports the last completed stage and missing files.

## Recommended command flow from chat

```text
image_gen: canonical front
  -> visual approval
image_gen: side/back/three-quarter using canonical front
  -> visual QC
image_asset_save
  -> assets/concepts/<slug>/source/generation-manifest.json
image_character_views_prepare
  -> assets/concepts/<slug>/prepared/prepared-manifest.json
blender_setup_character_references
  -> assets/concepts/<slug>/blender/<slug>_references.blend
blender_viewport_screenshot
  -> visual alignment review
```

## Why generation and persistence are separate

The chat image model creates or edits images. The local MCP bridge persists and processes their bytes. Keeping the two responsibilities separate means the same storage and Blender pipeline can accept images from ChatGPT, another generator, a drawing app, or a manually edited file.

## Modes

- **Quality:** generate and review each view after the canonical front. Recommended for production characters.
- **Fast:** generate the remaining views as a batch after approving the canonical front. Recommended for exploration.

See `GUIDE.md` for the full state machine and completion rules.
