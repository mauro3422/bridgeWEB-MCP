# Bridge release and isolated HTTP verification contracts

## Packaged dependency byte-parity invariant

A local `file:` npm dependency is not considered adopted merely because `npm install` reports `up to date`. Replacing a tarball under the same version/path can leave stale package bytes in npm cache or `node_modules`. For Bridge releases that consume a rebuilt MSSR artifact, verify source tarball = vendor tarball and compare SHA-256 of critical source/installed runtime files; if parity fails, reinstall through a clean bounded cache or bump the package version before trusting tests/live adoption. Package-manager status is convenience evidence, not the source of truth for runtime bytes.

## Executable release parity invariant

Before a restart is considered an adoption attempt, the package version, source runtime version, compiled executable (`dist/config.js` or equivalent), and packaged dependency bytes must agree. A source/package preflight that ignores `dist/` can pass while the watchdog correctly relaunches stale code. After any late source-version edit, rebuild before restart and read back both compiled and live versions. A watchdog ack proves restart execution, not adoption of the intended bytes. The 0.6.102 C2b adoption demonstrated this directly: the first restart ack succeeded but relaunched compiled 0.6.101; only after rebuilding and proving `package=source=dist=0.6.102` did the next restart adopt the intended runtime.

## HTTP test health-store isolation invariant

Any test that launches `dist/http.js` must isolate **all** host-owned observability stores from live `data/`, not only metrics/logs: Skill Health, Project Context Health, Runtime Health, and Project Situation must point at temporary test paths, and Project Health/Project Situation must use explicit bounded test roots. The top-level isolated regression runner sets these paths, but standalone HTTP fixtures must also set them so direct test execution cannot pollute production observability. After changing scheduler/store plumbing, verify live-store boot/snapshot identity before and after focused tests; test-generated runtime or Situation evidence in live stores is a regression, not harmless telemetry.
