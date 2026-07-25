# verify-and-report

## Goal

Verify the chosen capture or write action and report what was actually observed or changed.

## Instructions

Confirm capture identity, boardId or album context from tool output. After a write, verify the tool result and, when visual placement matters, inspect the resulting Board view. Report separately: observed user traces, interpreted content, dashboard/album conclusion, and any confirmed Board mutation. Preserve uncertainty when visual evidence is incomplete.

## Availability reporting

State which layer succeeded: dedicated schema, runtime fallback, saved capture retrieval, or live Board capture. If access failed, include the exact layer/error and do not claim the Board itself is unavailable when only schema discovery failed.
