# align-and-compare

## Goal

Compare the actual game render against the actual reference image using equivalent, verified views.

## Instructions

Before comparison, prove that the intended subject appears in every capture. A valid capture must pass a subject-presence gate based on the real viewport image, not only projected bounds or file validity. Record subject occupancy, bounding rectangle, center offset and edge contact. Reject and recapture when the subject is absent, too small, unintentionally cropped, badly off-center or contaminated by unrelated UI/assets.

Pair each render with the most equivalent reference view. Crop reference panels, normalize background and bounds, align by base/center/height, and generate:

- side-by-side reference/render;
- alpha overlay;
- superimposed contours;
- difference map;
- silhouette and framing metrics.

The agent must inspect the original reference, original render and diagnostics together. For each pair, save:

- characteristics preserved;
- characteristics missing;
- unintended additions;
- distorted proportions or topology;
- material/VFX/growth differences;
- camera or projection mismatch;
- confidence and next correction.

Evaluate silhouette and mass hierarchy first, then topology, materials, surface detail, VFX, growth and integration. Metrics are diagnostic; they cannot replace visual review or prove artistic quality.