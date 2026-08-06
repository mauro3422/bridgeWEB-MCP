# Character Concept → Blender

## Purpose

Create consistent character design and construction views, persist and normalize them, validate the real files and semantic directions, install them as correct Blender Image Empties, and keep the loop resumable.

The image generator creates or edits visual references. Bridge tools save, inspect, normalize, validate, install and review them.

## Two-master contract

Lock two separate authorities:

1. **Design master** — normally `front_right_3q`, perspective allowed. It owns style, materials, markings, clothing, facial identity and volume intent.
2. **Geometric master** — `front`, orthographic visual language. It owns proportions, center, baseline, landmark heights and construction alignment.

Do not treat the three-quarter design image as measurable geometry. Do not let the front construction view redesign materials or hidden features.

## Concurrent reference-only mode

When Mauro says he is modeling while the agent generates references, stop the pipeline before any live Blender phase. Generate and save images, run semantic review, and prepare the pack with:

```text
operationMode: reference-only
userModeling: true
targetBlendFile: <exact intended .blend path>
```

The persisted manifest must report `blenderInteractionAllowed: false`, defer installation and list live Blender tools as forbidden. Do not call `blender_open`, inspect the scene, focus Blender, capture its viewport, install references, execute code or save the `.blend`. Resume installation only after a later `blender_status` exact-path/PID/port preflight and no conflicting recent human activity.


## Default mode

Use quality mode unless speed is explicitly more important.

### Quality mode

```text
brief_locked
→ design_master_approved
→ geometric_front_approved
→ each derived view generated and reviewed separately
→ sources_saved
→ reference_pack_prepared
→ semantic_and_byte_validation_passed
→ blender_scene_installed
→ installed_planes_reviewed
→ ready_for_blockout
```

Regenerate only the failing view. Preserve accepted sources and record a new pack revision when an approved trait changes.

### Fast mode

After both masters are approved, derive the remaining views in one batch. Every output still requires individual semantic QA before installation.

## Phase 1 — Lock the brief

Create `character-brief.json`. Lock at least:

- species and character identity;
- head-to-body ratio and body proportions;
- shoulder, hip, hand and foot shapes;
- face, eyes, ears and muzzle;
- tail count, base, length and resting direction;
- palette and exact markings;
- clothing and accessories;
- material style;
- intended height and game triangle budget;
- rig family and moving appendages;
- asymmetries and handed features.

Anything not locked may drift between views.

## Phase 2 — Generate the design master

Generate one controlled full-body three-quarter image using `prompts/design-master.md`.

Requirements:

- exactly one complete character;
- relaxed neutral pose;
- readable face, torso depth, hands, feet and tail base;
- neutral background and level camera;
- no text, border, scenery or unrelated props;
- no cropped extremities;
- no dramatic action or lens distortion.

Approve identity, materials, markings and volume intent before generating construction views.

## Phase 3 — Generate the geometric front

Generate `front` using `prompts/front.md`, attaching the approved design master.

Requirements:

- true front orthographic-like construction view;
- full body visible;
- relaxed A-pose when rigging is expected;
- arms separated from torso and legs separated enough to read the silhouette;
- centered body and common foot baseline;
- no camera tilt, dramatic perspective or cast shadow hiding the feet.

The front becomes `masters.geometry`. It must preserve the design master rather than becoming a new design.

## Phase 4 — Derive construction views

Use `prompts/derived-view.md`. Attach both approved masters and one adjacent approved construction view when useful.

Canonical ids:

```text
front
rear
left
right
top
bottom
front_left_3q
front_right_3q
rear_left_3q
rear_right_3q
```

For a symmetric starter character, the minimum useful set is:

```text
front
rear
right or left
front_right_3q or front_left_3q
```

For asymmetric characters, generate both `left` and `right`. Add `top` or `bottom` only when the silhouette, mounts, wings, tail layout or equipment requires it.

Every cardinal construction view must be orthographic-like. A true side is not a three-quarter view; a rear view must not show the face.

## Phase 5 — Semantic visual QA

Before marking a view `pass`, inspect the actual image.

### Direction

- front and rear are true opposites;
- left and right expose opposite sides and preserve handed details;
- top is overhead;
- cardinal construction views do not use a perspective camera;
- three-quarter images are labeled as design views, not construction measurements.

### Identity

- same face, eyes, ears and muzzle;
- same head/body ratio, shoulders, hips, hands and feet;
- same tail count, base, length and markings;
- same clothing, accessories, circuitry, tattoos, stripes and symbols;
- no extra limbs, digits, ears, horns or hidden duplicate appendages.

### Construction compatibility

- compatible total height and baseline;
- compatible torso and limb lengths;
- front and side imply plausible depth;
- moving parts and asymmetries remain on the correct side;
- no clipped subject, merged limbs or unreadable joints.

Record concrete notes. Use `pending` when not reviewed and `fail` when the direction or identity is wrong. Installation should require `pass`.

## Phase 6 — Save sources

Call `image_asset_save` with stable roles, prompts, source provider and useful metadata. Keep source masters separate from normalized derivatives.

Recommended layout:

```text
assets/concepts/<slug>/
  brief/character-brief.json
  source/
    <slug>_front_right_3q.png
    <slug>_front.png
    <slug>_rear.png
    <slug>_right.png
    generation-manifest.json
  prepared/
    <slug>_<role>.png
    <slug>_reference-pack.json
  blender/
    <slug>_references.blend
    <slug>_references.reference-install.json
  review/
```

Never silently overwrite an accepted source pack.

## Phase 7 — Prepare the generic pack

Prefer `image_reference_pack_prepare` for new work.

Each item declares:

```text
role
inputPath
usage: construction | design
projection: orthographic | perspective
semanticQa
optional landmarks
```

Use:

- `alignment: baseline` for grounded characters;
- PNG masters when practical;
- identical target canvas for all views;
- named landmarks when exact cross-view alignment matters.

Useful character landmarks include top of head, eyes, chin, shoulders, elbows, wrists, hips, knees, ankles and ground.

Preparation may crop, translate and uniformly scale. It must never non-uniformly stretch an image to force agreement.

`image_character_views_prepare` remains the historical four-view normalization path, not the preferred generic contract.

## Phase 8 — Validate

Call `blender_validate_reference_pack` with the roles required for this character and `requireSemanticQa: true`.

Validation checks the actual bytes and manifest:

- unique canonical roles;
- cardinal construction views marked orthographic;
- semantic QA status;
- signatures, dimensions, byte counts and SHA-256;
- shared construction canvas;
- accidental duplicate images for different cardinal directions;
- required roles and valid master references;
- blocking and cross-view warnings.

Regenerate or repair only failed views. Do not install a failed or pending pack.

## Phase 9 — Install in Blender

Call `blender_install_reference_pack` with `layout: axis_aligned`.

Expected construction layout:

```text
front + rear  → same XZ plane, opposite image-side visibility
left + right  → same YZ plane, opposite image-side visibility
top + bottom  → same XY plane, opposite image-side visibility
```

Construction references must be:

- behind geometry;
- visible in orthographic axis-aligned views;
- hidden in perspective;
- locked from selection;
- excluded from rendering;
- placed in `REFERENCES_CONSTRUCTION`.

Design three-quarter views belong in `REFERENCES_DESIGN` and remain hidden by default.

Use `layout: surround` only for explicit inspection. It offsets references and permits perspective viewing, so it is not the modeling default.

`blender_setup_character_references` remains a compatibility wrapper for front/side/back/three-quarter packs. It now installs through the same generic axis-aligned contract.

## Phase 10 — Review and iterate

Before blockout:

1. capture front, side and optional top views;
2. verify the correct reference appears from each side;
3. verify planes share the intended origin and scale;
4. confirm perspective hides construction references;
5. inspect the installation manifest.

Once geometry exists:

- use `blender_review_bundle` for fixed front/right/back/three-quarter/top renders and metadata;
- use `blender_focus_review` when Mauro selects a face, edge, vertex, object or 3D Cursor location and asks to inspect it;
- recapture the same views after corrections.

## Repair one view

Use `prompts/repair-view.md`. Attach both masters, the failed view and an adjacent approved construction view when useful. Describe exact visible errors and immutable features. Never ask vaguely to “improve” the image.

## Completion rule

The loop is ready for blockout only when:

- the brief and both masters exist;
- required derived views exist;
- each installed view has semantic QA `pass`;
- source and prepared manifests exist;
- `blender_validate_reference_pack.valid` is true;
- the `.blend` and installation manifest exist;
- the installed Image Empties were checked for side, axis, depth, selection and render behavior;
- the viewport or review capture was inspected.

References stay in the working `.blend`. Save a separate clean deliverable without `REF_*`, temporary cameras, lights or helpers before game export.
