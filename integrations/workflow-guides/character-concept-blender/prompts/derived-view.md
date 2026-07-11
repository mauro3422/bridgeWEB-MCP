# Derived-view prompt

Attach the approved canonical front image as the primary reference. Attach the best matching approved adjacent view when available.

```text
Create a single full-body {{viewName}} concept view of EXACTLY the same character shown in the reference image.

IDENTITY MUST NOT CHANGE
Preserve the same species, face, head-to-body ratio, eye color and spacing, ear shape, muzzle length, shoulder width, torso length, hip width, hands, feet, tail count, tail base, tail size, palette, markings, clothing, and accessories. The character brief is authoritative when a hidden area must be inferred.

VIEW
- requested view: {{viewInstruction}}
- full body visible from ear tips to feet
- same neutral relaxed A-pose as the canonical front
- same approximate camera height, focal style, and character scale
- arms separated from torso
- feet on one horizontal baseline

MODELING REQUIREMENTS
- clean readable silhouette
- no limb merging
- hands and feet anatomically consistent with the reference
- tail base and tail direction clearly readable
- shapes should remain suitable for low-poly 3D reconstruction

PRESENTATION
- one character only
- clean pure-white background
- soft neutral studio lighting
- no text, labels, borders, props, scenery, or floor clutter

NEGATIVE CONSTRAINTS
- no redesign
- no alternative colors or markings
- no extra limbs, digits, ears, horns, or tails
- no cropped body parts
- no action pose
- no dramatic perspective
- no three-quarter angle when a true side or back view is requested
```

View instructions:

- `side`: true right-facing side profile; both eyes must not be equally visible.
- `back`: true rear view; face must not be visible; show shoulders, spine area, tail base, and leg spacing.
- `three-quarter`: controlled 3/4 view, facing slightly toward camera, preserving the same scale and neutral pose.
