# Canonical project-doc reference discoverability gap

Observed cross-project capability gap: when a canonical project document is created, split, renamed or superseded, the current MSSR project-context lifecycle does not automatically register/update a discoverable canonical reference for that new owner. Existing `project_context_maintain` behavior is intentionally safe and exact-only: it relocates already-indexed sections and refuses to infer semantic ownership or invent segment boundaries.

Desired owner split: portable MSSR should define canonical-reference registration/health semantics; Bridge should expose/persist the host transaction and postflight receipt.

Desired contract:
- workflows that designate a newly created/split document as a canonical owner register/update explicit canonical-reference metadata or a bounded reference module in the same reviewed persistence flow;
- never infer canonical ownership from filename alone;
- Project Context Health detects missing, stale, deleted and superseded reference targets;
- create/split/rename postflight reports `mssrDiscoverability` together with the persisted document path/identity;
- exact maintenance preserves declared references through relocation;
- regression coverage includes create, split, rename/supersede and delete/stale-reference cases.

Status 2026-09-24: the portable MSSR source owner now has the retroactive health half prepared for `0.2.74`. `Project Context Health` performs a bounded project-document reference audit, recognizes exact manifest sources and exact project-relative pointers from selectable `.mssr` context, returns high/medium/low advisory candidates, and raises `REVIEW_PROJECT_DOC_REFERENCES` only for strong top-level candidates. It never infers canonical ownership or writes a manifest automatically. Focused create/connect/rename/delete and maintenance regressions pass, and a 39-project dry audit measured 27 high-priority candidates across 17 projects at about 15 ms average per project. The remaining create/split transaction/postflight registration half is still a separate follow-up.

Runtime adoption is also still separate: Bridge `0.6.140` currently consumes exact packaged MSSR `0.2.73`, so the new retroactive audit is source-implemented but not yet live through Bridge `project_context_load`. Do not repackage these new bytes under the existing `0.2.73` identity. Until a versioned `0.2.74` artifact is adopted, agents creating/splitting canonical docs must still explicitly call `project_context_capture`/`project_context_update` (or update the reviewed reference module) when immediate discoverability is required.
