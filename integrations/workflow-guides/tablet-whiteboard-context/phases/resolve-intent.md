# resolve-intent

## Goal

Determine whether the user refers to the live Board, the most recent saved capture, the capture album, or a write/annotation action.

## Instructions

Treat 'board' as TabletWhiteboard unless the surrounding context clearly names another board. Distinguish current/live requests from saved/album requests. Never replace a request for a saved capture with a fresh capture. When the user says not to capture, remain read-only and use saved metadata or captures only.
