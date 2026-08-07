# publish-and-verify

## Goal

Refresh the library after provider work and prove the dashboard reflects durable evidence without mutating the provider from the library workflow.

## Instructions

Rebuild and verify MauroAssetLibrary, read back manifest/report, inspect affected previews when visual state matters, and compare provider workspace against baseline when the library task itself touched or inspected a dirty provider. Verify forbidden canonical formats were not copied. Persist only library changes when operating in the library repo; stage/commit provider work only from the provider's own workflow.
