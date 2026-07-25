# capture-matrix

## Goal

Capture all required combinations with incremental progress, recovery and verified subject presence.

## Instructions

Select the intended Roblox Studio explicitly before preparing, exporting, capturing or cleaning. Perform a disposable warm-up before the matrix. Save every image immediately with bytes, hash, camera, phase, state, attempt and capture signature. Resume only evidence whose file and signature remain valid.

For a static turnaround, execute the matrix sequentially with one shared hero camera and a reversible object rotation. Before every shot:

- clear Studio selection and temporary helpers;
- apply the declared yaw to the subject from one saved base pivot;
- activate the declared camera marker and FOV;
- wait for the viewport to settle;
- capture one image and claim it before advancing;
- record the actual yaw and camera signature.

After the hero rotations, restore the subject before activating a separate top or detail camera. Reject the batch if the hero signatures differ when the plan declares `fixed-camera-turntable`, or if the subject does not return to its original pivot.

A valid image file is not sufficient evidence. Before accepting each capture, verify against the actual viewport pixels that the intended subject:

- is present;
- occupies enough of the frame to judge;
- is not unintentionally cropped;
- remains within center/edge tolerances for the profile;
- is not hidden by Studio UI, labels, unrelated review assets or stale clones.

Use a reversible silhouette/subject probe or an equivalent real-image check. Store occupancy, detected subject bounds, center offset, edge contact and validation verdict. A failed presence check must reject the capture, trigger camera/refit diagnosis and prevent dashboard completion.

Prefer `CaptureService` client PNGs when Play is healthy. When Play cannot start but Studio MCP `screen_capture` returns current framebuffer pixels, use the Edit backend as a supported fallback. Treat its original JPEG/PNG as the immutable raw master. Clear selection before capture, isolate the stage outside the gameplay map and validate distinct hashes.

When fixed editor overlays remain outside the protected subject region, create a separate review derivative using a safe native-pixel crop. Record the raw hash, crop rectangle, detected subject box, UI regions excluded and `noSpatialResample=true`. Never paint over, overwrite or relabel the raw as clean. A physical desktop/window screenshot remains diagnostic-only.

After local masters pass automated checks, attach the original PNG/JPEG/WebP files with `image_file_attach`, preferably as one bounded batch and with each recorded SHA-256. Do not use manual Base64, temporary HTTP servers, tunnels or tiny recompressed previews for normal visual inspection.

Retry one capture without deleting previous valid images. Accept JSON with or without BOM. A `screen_capture` timeout must not automatically close a healthy MCP session and cause cascading WebSocket failures.
