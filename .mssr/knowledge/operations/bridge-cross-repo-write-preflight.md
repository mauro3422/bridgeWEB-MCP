# Bridge cross-repository write preflight

## Ownership boundary

MSSR evaluates declared cross-repository ownership but always returns `advisoryOnly: true` and `authorizationGranted: false`. Bridge owns filesystem permission, trace/project matching, destination checks, and deciding whether its writer is called. A positive MSSR decision alone never authorizes a write.

## Current host gate

Bridge 0.6.186 accepts `crossRepoOwnership` on `bridge_tool_action`. It currently protects only a declared delegated `write_text_file` call. Before dispatch, Bridge requires:

- the active target trace to match `currentTraceId` and `targetProject`;
- a separate persisted `relatedTraceId` whose project matches `sourceProject`;
- the declared owner to match `expectedOwnerProject` and MSSR to return `host-preflight-required`;
- an explicit target project root whose basename matches the target, an exact project-relative `targetRef`, and `destinationState=absent` with no existing destination;
- the wrapper's existing exact `confirmToolName` confirmation.

If any check fails, Bridge returns `executed:false` before invoking the writer. Source and target traces stay separate. The isolated fixture assigns commercial data to `Auro-3D` and the panel to `auro-3d-web`; it blocks the unreviewed copy and permits the reviewed fixture write only with both project traces and the destination checks aligned.

## Coverage limit

This is a scoped pre-write guard for the declared wrapper path, not a global filesystem/terminal policy. It does not stage bytes, journal a receipt, replay idempotently, read back the result, roll back, or recover a partial cross-repository transaction. Extend this module and regression before claiming those guarantees.
