# verify-and-pack-evidence

## Goal

Re-read exact source ranges and produce a bounded cited evidence pack.

## Instructions

Revalidate selected handles using mssr_librarian_fetch, or pack a bounded set with mssr_librarian_evidence_pack. The pack's paragraphs are verbatim source ranges, not generated prose or semantic compaction. Retain sourceRef, line range, revision, handle ID and fingerprint. Reject stale/tampered ranges. Compare requested answer dimensions with evidence coverage; if a material gap remains, issue a bounded targeted search/selection pass, otherwise stop.
