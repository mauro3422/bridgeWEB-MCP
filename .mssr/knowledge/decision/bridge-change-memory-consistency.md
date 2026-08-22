## Change and memory consistency

Every substantive release should have one versioned `changelogs/X.Y.Z.md` summary and explicitly review PROJECT_CONTEXT, PROJECT_MEMORY, and PROJECT_STATE impact. `project_change_consistency` is a read-only persistence gate: it may report drift or block publish readiness, but it never writes project memory automatically. `reviewed-none` is a deliberate review result; `pending` means persistence is incomplete.
