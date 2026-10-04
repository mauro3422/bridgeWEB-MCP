# retrieve-and-select

## Goal

Search explicit project sources and use Jev only for bounded selection decisions.

## Instructions

Call mssr_librarian_search with lexical defaults. Opt into project-context metadata only when the source declares exact useful selectors, and report when the sidecar is absent/stale. When a Choice is useful, pass exact revision-bound candidateHandles from search to mssr_librarian_jev_select. Jev can choose only among caller-supplied evidence; it does not search or write prose. Treat confidence and Noul as descriptive and uncalibrated; never use an arbitrary threshold as a truth or write gate. A no-selection/abstention result means keep searching or report the gap.
