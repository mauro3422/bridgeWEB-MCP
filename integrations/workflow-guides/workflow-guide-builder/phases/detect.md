# detect

## Goal

Identify whether the current request describes a reusable pattern and whether an existing global or project guide already applies.

## Instructions

Call `workflow_guide_recommend` with the user's request and the project root when known. Prefer a project match over a global match. Load an existing guide when the recommendation is strong. Recommend creating a new guide when the request clearly describes future or repeated behavior but no existing guide matches. Do not force a guide for a one-off task.
