# create

## Goal

Create the approved workflow guide in the correct global or project scope.

## Instructions

Call `workflow_guide_create` with a kebab-case name, concise description, activation triggers, exclusions, positive examples, ordered phases, and recommended tools. For project scope, pass the project root. Do not overwrite an existing guide unless the user explicitly requests replacement or the existing guide is being intentionally revised. After creation, load the guide and inspect the returned manifest and entrypoint.
