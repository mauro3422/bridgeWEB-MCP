# hot-reload-loop

## Goal

Keep the expensive PZ client alive across ordinary Lua edits and runtime probes without stealing focus or requiring the visible PZ debugger.

## Instructions

Prefer terminal/file-trigger control over typing into the PZ Lua debugger because the user may alt-tab. Stage the target Lua file, write a unique request under `cachedir/Lua`, and have a dev-only controller consume it on a callback that is proven to continue while the intended debug state is paused/background. Call `reloadLuaFile()` with the complete mod-relative path including mod id and B42 version folder (for example `ModId/42/media/lua/client/...`). Verify request, target execution, and completion from logs or a response receipt.

When repeated runtime actions are needed, prefer a bounded request/response command channel over UI automation. Use a unique token, an allowlisted command name and arguments, and a matching response file under the isolated cache. Do not expose arbitrary Lua `eval` unless a future task explicitly requires and safely scopes it. Background PZ may throttle callbacks, so command clients should use a bounded but tolerant timeout instead of assuming sub-second responses.

Keep the callback that owns reload/RPC control registered once at startup. Do not self-hot-reload that controller while it is executing its own callback, and do not depend on dynamically registering another critical callback from inside a hot-reloaded callback unless the current B42 build has been explicitly proven to schedule it. If a paused debug scenario does not run the normal world-render callback, a dev-only stable callback may temporarily own the visual probe, provided the test verifies that the visual remains non-authoritative and does not create duplicate world items.

Disable focus-loss pause only inside the isolated development profile when needed; never rewrite the user's normal profile for this purpose. Treat pause/unpause APIs as build/scenario dependent: if the debug scenario remains pause-locked, design the lab control path to work while paused instead of stealing focus to resume it.

Restart only for startup-only/controller/model/resource changes or when the active controller itself must be replaced. Otherwise keep the existing owned PZ process alive and iterate through reload + command receipts.
