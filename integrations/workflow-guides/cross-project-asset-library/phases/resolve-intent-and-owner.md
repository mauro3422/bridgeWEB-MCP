# resolve-intent-and-owner

## Goal

Determine whether the user wants to browse, refresh, onboard a provider, publish asset evidence, or continue work in an owning project; identify the authoritative project before any mutation.

## Instructions

Load MauroAssetLibrary project context when the library itself must be inspected or rebuilt. Treat every provider as read-only while operating under the library. Distinguish library-owned adapters/manifests/UI from provider-owned sources and runtime files. If the requested action requires editing an asset, switch to the owning project instead of editing it through the library.
