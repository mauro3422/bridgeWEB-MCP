# Repair one inconsistent view

Attach:

1. approved design master;
2. approved front geometric master;
3. current failed view;
4. one adjacent approved construction view when useful.

```text
Repair ONLY the {{role}} view of this character.

KEEP FROM THE DESIGN MASTER
- exact identity, face, species, materials, palette, markings, clothing, accessories, hands, feet, tail count and tail base

KEEP FROM THE GEOMETRIC FRONT MASTER
- exact total height, head/body ratio, shoulder width, torso length, hip width, limb lengths, joint heights, baseline and centered scale

FIX THESE OBSERVED ERRORS
{{problemsToFix}}

DO NOT CHANGE
{{featuresToPreserve}}

OUTPUT
- one complete {{role}} image only
- requested direction must be unambiguous and correctly handed
- cardinal roles must be orthographic-like and axis-aligned
- full subject visible, neutral pose and readable construction landmarks
- same background, scale language and lighting as approved views
- no text, labels, border, watermark, props or scenery
- no extra limbs, digits, ears, horns or tails
```

Describe concrete errors rather than asking for a vague improvement. Examples:

- “The rear image is still three-quarter; remove all facial visibility and align the shoulders horizontally.”
- “The right-side drawer unit moved to the left side; restore its handed position from the front master.”
- “Match the tabletop height and leg endpoints to the front landmarks without stretching the image.”
- “Tail base must begin at the lower spine, not the left hip.”

After generation, visually inspect the result and update semantic QA. A repaired file remains blocked while its status is `pending` or `fail`.
