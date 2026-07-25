# capture-resiliently

## Goal

Produce complete frames despite cold-renderer or individual-frame failures.

## Instructions

Warm the renderer before the first evidence frame, retry bounded failures, inspect Workspace after timeouts, write each successful frame to the manifest immediately, and resume only missing captures.

After local masters pass validation, attach the original files with `image_file_attach` as a bounded batch and include recorded SHA-256 values. Do not use binary chunks, copied Base64, temporary HTTP servers, tunnels or tiny previews for normal inspection.
