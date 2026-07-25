# TabletWhiteboard Context and Album Review

## Purpose

Inspect and use Mauro's TabletWhiteboard as a shared visual workspace. Resolve whether the user means the live board or a saved album capture, inspect human traces and annotations before interpreting images, use the capture dashboard deliberately, and write or diagram only after preserving the user's visual context.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **resolve-intent** — Determine whether the user refers to the live Board, the most recent saved capture, the capture album, or a write/annotation action.
2. **acquire-context** — Obtain the smallest correct visual context before interpreting or changing anything.
3. **inspect-human-layer** — Read the user's strokes, arrows, circles, text, grouping, spatial emphasis, and corrections as first-class evidence.
4. **interpret-dashboard** — Use the capture dashboard and album according to the comparison task rather than treating all images as one flat sequence.
5. **act-on-board** — Add text, diagrams, SVG, or existing images without erasing or obscuring the user's context.
6. **verify-and-report** — Verify the chosen capture or write action and report what was actually observed or changed.

## Tool policy

Recommended tools:

- `whiteboard_capture_pc_view`
- `whiteboard_latest_capture`
- `whiteboard_capture_list`
- `bridge_tool_query` as the required read-only fallback when a Whiteboard tool exists in the runtime catalog but its dedicated connector schema is not surfaced
- `whiteboard_add_text`
- `whiteboard_add_diagram`
- `whiteboard_add_svg`
- `whiteboard_insert_image`
- `image_file_attach`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
