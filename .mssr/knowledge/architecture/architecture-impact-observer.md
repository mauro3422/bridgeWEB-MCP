# Architecture Impact host adoption boundary

Bridge is the first real host adapter for the portable MSSR Architecture Impact lifecycle. MSSR owns declarations, touched-ref reverse mapping, projection/refinement, derived/invariant semantics, reviewed-current evaluation and bounded context feedback. Bridge owns host observation, ignored review receipts and notice transport only. `semanticOwner=mssr` and `canonicalRewriteAllowed=false` remain invariant.

Baselines and reviewed-current receipts live only under ignored `.mssr/runtime/architecture-impact/` and require explicit review decisions; missing/corrupt/stale evidence fails open to REVIEW. WATCH stays quiet. REVIEW uses the existing Bridge notice transport with bounded architecture ids, reason codes and exact context/authority requests rather than raw hashes or source payloads.

Bridge does not add an always-on watcher, autoload context, auto-update baselines/ADRs/manifests, rewrite canonical architecture, or create a second semantic notice system. Writer/dispatch coverage and host implementation details live in the indexed Architecture Impact writer-integration module.
