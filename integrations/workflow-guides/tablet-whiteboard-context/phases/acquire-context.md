# acquire-context

## Goal

Obtain the smallest correct visual context before interpreting or changing anything.

## Instructions

Use whiteboard_capture_pc_view only for the currently visible live Board. Use whiteboard_latest_capture when the user explicitly asks for the most recently saved image without creating a new one. Use whiteboard_capture_list to inspect the album before selecting among multiple saved captures. Do not infer that the newest item is the intended one when the user references a particular stage, trace, or session.
