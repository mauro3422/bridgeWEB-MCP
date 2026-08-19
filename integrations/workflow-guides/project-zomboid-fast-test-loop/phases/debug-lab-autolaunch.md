# debug-lab-autolaunch

## Goal

Enter a tiny deterministic lab without menus or character setup.

## Instructions

Use -debug with a dev-only DebugScenario and native forceLaunch where verified. If the small challenge map lacks a normal spawn region, provide a synthetic valid spawn before world init. Avoid delayed custom OnTick auto-launchers that can fire after entering the world.
