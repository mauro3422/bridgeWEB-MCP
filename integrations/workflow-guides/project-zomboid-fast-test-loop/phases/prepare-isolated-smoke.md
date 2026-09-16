# prepare-isolated-smoke

## Goal

Prepare a repeatable dev profile without touching the user's normal Zomboid profile.

## Instructions

Prefer a project-local `-cachedir` and minimal enabled mods. For B42 ActiveMods/default.txt on MauroPrime, write UTF-8 without BOM. Prefer a physical mod copy when junction enumeration is unproven.

When testing the user's "current save" or the target of **Continue**, resolve it from the active cachedir's `latestSave.ini` first and verify the referenced mode/folder plus recent timestamps. Never reuse a remembered/harness SaveId as a proxy for the current game. A wrong SaveId can make diagnostics look consistent while `Continue` is loading a different folder.

For existing saves, remember that the save may own its own `mods.txt`; updating only the profile/default mod list does not necessarily give `getSaveInfo()` a non-nil save `ActiveMods`. In B42.20.4, a latest save with no `mods.txt` can reach vanilla `MainScreen.getMissingMods(nil)` and throw before world load. Prefer the native Load Game -> selected save -> Mods flow (or a proven PZ `ActiveModsFile` writer). In an isolated disposable cachedir only, when the resolved latest save has **no** `mods.txt` and the profile `mods/default.txt` is already the intended canonical set, a bounded compatibility workaround is to copy that exact file byte-for-byte into the resolved save, verify identical SHA-256, and restart before loading. Never overwrite an existing save `mods.txt`, never apply this to the user's normal profile, and do not synthesize the format by hand.

For `zomboid-smartwatch-network`, prefer `tools/setup_pz_smoke_lab.py` and `tools/restart_pz_smoke_lab.ps1` instead of ad-hoc launch commands. `--save-id` / `-SaveId` identify and validate a resolved save without modifying its metadata; optional N3WO compatibility uses `--with-n3wo` / `-WithN3WO`, and real-save testing uses `--no-smoke-lab` / `-NoSmokeLab`. `SmartwatchSmokeLab` owns a force-launch debug scenario, so never leave it enabled when the user asked to continue an existing save. Conversely, when the user asks for the quick SGPS lab/harness, do not pass `-NoSmokeLab` or a remembered SaveId: success requires runtime proof of `SmartwatchSmokeLab` loaded, native `forceLaunch`, `READY`, God Mode enabled, battery/watch fixtures seeded, the 100% watch worn, simulated peer available, HUD requested=true, and terrain=false at startup. A later clean compatibility pass should omit N3WO so a stale copied overhaul cannot remain in the isolated profile.
