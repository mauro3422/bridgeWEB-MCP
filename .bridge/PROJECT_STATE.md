# Bridge project state

## Current release
Bridge `0.6.93` is live after a controlled HTTP watchdog restart with 149 tools. It builds on the verified 0.6.92 Godot/risk-classification work and routes uploaded audio/video listening, transcription, and interpretation through the existing `narrated-media-review` workflow and canonical `media_review_ingest` path. MSSR route/bootstrap responses surface workflow-guide recommendations, and `.bridge/mssr-context-inbox.json` remains ignored runtime delivery state rather than Git-tracked project knowledge. Pure transcription is a supported fast path; generic Whisper/local ASR fallback is allowed only after the canonical media path is observably unavailable or failed, and meme/video interpretation requires transcript/audio evidence plus a representative visual frame. Bridge packages MSSR core `0.2.15`. Prepublication verification passed typecheck, build, generated `TOOLS.md`, focused narrated-media routing/contract checks, `git diff --check`, and the full regression suite. Live readback after restart reports server `0.6.93`, tunnel `live`/`ready`, 149 tools, and `workflow_guide_recommend("transcribime este audio")` selects `narrated-media-review`.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
