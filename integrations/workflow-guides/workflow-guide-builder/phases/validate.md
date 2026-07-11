# validate

## Goal

Verify that a guide is discoverable, loadable, appropriately scoped, and not over-triggered.

## Instructions

Run `workflow_guide_recommend` with at least one intended request, one paraphrased intended request, and one unrelated request. Confirm that intended requests rank the guide strongly and the unrelated request does not. Run `workflow_guide_load` for the entrypoint and each important phase. Confirm every referenced file exists and the recommended tool list is accurate. Correct triggers or phase mappings when validation fails.
