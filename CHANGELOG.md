# Changelog

The canonical Bridge release history now lives under [`changelogs/`](changelogs/INDEX.md).

- Current source release: [0.6.191](changelogs/0.6.191.md) (expandable Project Health recommendations and bounded reference candidates; WATCH stays quiet and REVIEW notifies)
- Version index: [changelogs/INDEX.md](changelogs/INDEX.md)
- Historical monolithic archive: [changelogs/LEGACY.md](changelogs/LEGACY.md)

New releases use one `changelogs/X.Y.Z.md` file with explicit `PROJECT_CONTEXT`, `PROJECT_MEMORY`, and `PROJECT_STATE` impact declarations so MSSR can audit change/memory consistency without parsing a growing global changelog.
