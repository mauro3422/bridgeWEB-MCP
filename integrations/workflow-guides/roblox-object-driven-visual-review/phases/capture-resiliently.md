# capture-resiliently

## Goal

Produce complete frames despite cold-renderer or individual-frame failures.

## Instructions

Warm the renderer before the first evidence frame, retry bounded failures, inspect Workspace after timeouts, write each successful frame to the manifest immediately, and resume only missing captures.
