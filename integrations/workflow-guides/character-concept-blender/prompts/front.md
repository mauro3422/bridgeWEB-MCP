# Canonical front-view prompt

Use this after filling values from `character-brief.json`.

```text
Create the canonical full-body FRONT view of the same original character described below.

IDENTITY LOCK
- Name: {{name}}
- Species: {{species}}
- Body proportions: {{bodyProportions}}
- Primary palette: {{primaryPalette}}
- Secondary palette: {{secondaryPalette}}
- Eyes: {{eyes}}
- Ears: {{ears}}
- Muzzle: {{muzzle}}
- Hands: {{hands}}
- Feet: {{feet}}
- Tail: {{tail}}
- Exact markings: {{markings}}
- Clothing/accessories: {{clothingAndAccessories}}

VIEW
- true front orthographic-like character concept view
- character centered and symmetrical
- full body visible from ear tips to feet
- neutral relaxed A-pose suitable for later 3D modeling
- arms separated from torso and hands readable
- legs separated enough to read the silhouette
- feet share one horizontal baseline

PRESENTATION
- clean pure-white background
- consistent soft studio lighting
- clean stylized 3D-like concept render
- low-poly-friendly shapes and readable silhouette
- no text, labels, borders, props, scenery, or other subjects

NEGATIVE CONSTRAINTS
- no extra limbs or digits
- no second tail
- no alternate markings or colors
- no alternate clothing
- no cropped ears, hands, tail, or feet
- no dramatic perspective, action pose, or camera tilt
```
