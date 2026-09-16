# preflight

## Goal

Resolve the owning PZ mod project and prevent accidental duplicate/over-budget launches.

## Instructions

Inspect active Project Zomboid/java/server processes and physical RAM before launching. Reuse the intended active runtime. Never launch a duplicate unless the test explicitly requires MP and memory budget is acceptable.

Before relying on a remembered Build 42 target, verify the actually installed/runtime build from current PZ files or fresh console startup evidence. Treat an unexpected build bump as a compatibility re-verification trigger; do not silently keep labeling evidence with the previous build.

Before composing an ad-hoc launch command, inspect the owning repository for project-owned smoke/MP launchers and harness installers. Prefer those scripts because they encode cachedir isolation, payload syncing, RAM gates, server location and connection details more reliably than chat-local commands.
