# Character Concept → Blender

This workflow turns generated character concepts into a consistent Blender modeling reference pack. It distinguishes visual design from geometric construction instead of asking one image to serve both purposes.

## Authorities

- **Design master:** normally `front_right_3q`; owns style, materials, markings and volume intent.
- **Geometric master:** `front`; owns proportions, baseline, center and construction alignment.

## Recommended flow

```text
locked character brief
  → generate and approve design master
  → generate and approve front geometric master
  → derive rear / side / optional opposite side
  → semantic visual QA for every view
  → image_asset_save
  → image_reference_pack_prepare
  → blender_validate_reference_pack
  → blender_install_reference_pack
  → inspect installed planes
  → begin blockout
  → blender_review_bundle / blender_focus_review
```

`image_character_views_prepare` and `blender_setup_character_references` remain available for the historical four-view character flow. New work should use the generic prepare → validate → install chain because it supports canonical left/right/top roles, per-view semantic QA, landmarks and props as well as characters.

## Tools

- `image_asset_save`: persists generated originals atomically with dimensions, hashes, prompts and provenance.
- `image_reference_pack_prepare`: crops and uniformly scales a generic pack without stretching; records roles, masters, semantic QA, occupancy, optional landmarks and cross-view warnings.
- `blender_validate_reference_pack`: verifies actual image bytes, roles, hashes, canvas dimensions, projections, semantic-QA state and required views.
- `blender_install_reference_pack`: creates the axis-aligned Blender working scene with side-aware Image Empties and a verified installation manifest.
- `blender_viewport_screenshot`: captures the exact current viewport.
- `blender_focus_review`: captures general/context/zoom evidence around a selected detail or the 3D Cursor.
- `blender_review_bundle`: renders repeatable model views and records geometry, materials, visibility, rig and animation context.
- `blender_character_loop_status`: reads either the compatibility character checkpoint or the generic installed-pack references.

## Blender layout

Construction references are installed as locked non-rendering Image Empties behind geometry:

```text
front + rear  → shared XZ plane, opposite visible sides
left + right  → shared YZ plane, opposite visible sides
top + bottom  → shared XY plane, opposite visible sides
```

They appear in orthographic axis-aligned views and remain hidden in perspective. Perspective design masters live in `REFERENCES_DESIGN` and are hidden by default.

`layout: surround` is an explicit inspection arrangement. It must not be used as the geometric modeling default.

See `GUIDE.md` for the state machine, generation constraints, semantic QA and completion gates.
