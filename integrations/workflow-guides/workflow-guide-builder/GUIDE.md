# Workflow Guide Builder

## Purpose

Turn repeated multi-step work into reusable, versioned, skill-like guides that ChatGPT can discover and load through Mauro's Bridge MCP.

A workflow guide is not a new model capability and is not a hidden prompt. It is a documented procedure with:

- activation keywords, phrases, examples, and exclusions;
- an entrypoint document;
- optional phase documents;
- recommended MCP tools;
- verification and resume rules;
- either global scope or project scope.

## Activation model

When a task looks repeatable, first call `workflow_guide_recommend`.

Typical signals:

- “siempre”, “cada vez”, “a futuro”;
- “skill”, “pipeline”, “workflow”, “plantilla”, “hook”;
- “cuando detectes este patrón”;
- a process with multiple ordered phases that will likely be reused.

The recommender returns one of three actions:

- `load_existing`: load the matching guide with `workflow_guide_load`;
- `propose_new`: explain that a reusable pattern was detected and recommend creating a guide;
- `none`: continue normally without forcing a guide.

Do not create a guide merely because one might be useful. Create it when the user asks for it or approves the recommendation.

## Scope

### Global

Stored in:

```text
bridge-mcp/integrations/workflow-guides/<guide-name>/
```

Use for processes that should work across projects.

### Project

Stored in:

```text
<project>/.bridge/workflow-guides/<guide-name>/
```

Use for repository-specific conventions, paths, commands, or quality rules. A project guide overrides a global guide with the same name when `projectRoot` is supplied.

## Design rules

- Use a clear lowercase kebab-case name.
- Write activation examples in the language users actually use.
- Add negative keywords to prevent false activation.
- Keep one coherent job per guide.
- Split long procedures into named phases.
- Reference existing MCP tools instead of pretending the guide performs side effects itself.
- Require tool confirmation before claiming files, builds, Blender scenes, emails, or other side effects exist.
- Define a resumable state for multi-step pipelines.
- Prefer a project guide when paths or behavior only apply to one repository.

## Creation flow

1. Detect and describe the repeatable pattern.
2. Search for an existing guide.
3. Decide global or project scope.
4. Define activation triggers and exclusions.
5. Define phases, outputs, tools, and verification.
6. Create with `workflow_guide_create`.
7. Load the new guide to verify its files and metadata.
8. Test recommendation against positive and negative example requests.
9. Refine triggers when false positives or false negatives appear.

## Relationship to MCP tools

A guide tells ChatGPT **when and how** to work. MCP tools define **what executable actions are available** and their input schemas.

The model sees the guide only after `workflow_guide_load` returns it. The model sees MCP tool metadata through `tools/list` and chooses tools based on descriptions, schemas, annotations, and server instructions.

## Completion rule

A new guide is complete only when:

- `guide.json` parses successfully;
- the entrypoint file exists;
- all phase files referenced by the manifest exist;
- recommendation finds it for at least one intended request;
- recommendation rejects or scores low for at least one unrelated request;
- loading returns the intended instructions and recommended tools.
