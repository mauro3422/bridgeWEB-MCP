# Derived construction-view prompt

Attach both approved authorities in this order:

1. the three-quarter **design master**;
2. the orthographic **front geometric master**;
3. one approved adjacent construction view when it helps resolve hidden structure.

```text
Create one complete {{role}} view of EXACTLY the same character shown in the approved references.

IDENTITY AUTHORITY — DESIGN MASTER
Preserve the exact species, face, materials, palette, markings, clothing, accessories, hands, feet, tail count, tail base and defining visual details.

GEOMETRY AUTHORITY — FRONT MASTER
Preserve the same total height, head-to-body ratio, shoulder width, torso length, hip width, limb lengths, joint heights, baseline and centered subject scale.

REQUESTED VIEW
{{viewInstruction}}

CONSTRUCTION REQUIREMENTS
- when the requested role is front, rear, left, right, top or bottom, use orthographic-like visual language with a level axis-aligned camera
- full subject visible with no cropped features
- same relaxed neutral pose as the front master
- no limb merging; hands, feet, joints and tail base readable
- same canvas language, baseline or center, lighting and neutral background
- preserve every locked asymmetry on the correct side

PRESENTATION
- one character only
- clean pure-white background
- soft neutral lighting without shadows hiding construction landmarks
- no text, labels, borders, watermark, props or scenery

NEGATIVE CONSTRAINTS
- no redesign, alternate colors, changed materials or changed markings
- no extra limbs, digits, ears, horns or tails
- no crop, action pose, camera tilt or dramatic perspective
- no three-quarter angle when a cardinal construction role is requested
```

Canonical instructions:

- `rear`: true rear view; face not visible; show shoulders, spine area, tail base and leg spacing.
- `left`: true subject-left side profile; preserve all left-side asymmetries and handed accessories.
- `right`: true subject-right side profile; preserve all right-side asymmetries and handed accessories.
- `top`: true overhead construction view; show head, shoulders, torso breadth, feet and appendage layout without tilt.
- `bottom`: true underside view only when mounts, feet, sockets or equipment require it.
- `front_left_3q`, `front_right_3q`, `rear_left_3q`, `rear_right_3q`: controlled perspective design/inspection views, never geometric measurement authorities.

Inspect the actual output and set semantic QA explicitly. Do not infer correctness from generation success.
