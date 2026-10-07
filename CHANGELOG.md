# Changelog

## 0.1.0 — 2026-10-07

### Subtasks

- Subtasks stack under their parent in the task list, collapsed by default. A parent row shows a chevron and how many of its subtasks are done (canceled ones aren't counted). Expanded parents are remembered in this browser.
- A task whose parent is filtered out of the list shows at the top level with `in <parent>`. Selecting a task or searching expands its parents.
- The task editor has a Parent picker (tasks in the same project, excluding the task and its own subtasks; saved with the other edits), a breadcrumb of parents, and a Subtasks section with + Add subtask.
- Finish is dimmed on a parent with planned or active subtasks and names them, mirroring GHH's `open_subtasks`.

### One meta editor

- Meta is edited as entry rows everywhere — key, rule (none / recommended / required to start / required to finish), kind, description, value (lists one per line) — each marked with its source (config, project, task). Replaces the meta text boxes and the Task fields editors. Needs GHH with `0005_meta_entries`.
- Admin → Config meta edits config entries. A project's Meta section shows config entries read-only with Switch off / Switch on, and edits its own entries (Save / Revert). The task editor shows config and project entries read-only, except that an empty slot has its own value box (the value is stored as the task's entry of that key, which is not repeated as a task row), and edits the task's own entries with the other task edits (Save, undo/redo).
- A finished task shows config and project entries as of finishing.
- The Start/Finish hint and the finish pre-check follow the rules from all three levels.

### Finishing tasks

- The outcome is the finish result: a read-only OUTCOME card shows on finished tasks only, and the task editor never sends `outcome`. Set it in the Finish panel (multi-line, starts empty); to change it, Reopen (which clears it) and finish again. Needs GHH with `0003_outcome_finished_only`; expected results go in the description.
- The shown outcome keeps its line breaks.
- Planned tasks offer Finish as well as Start; finishing one starts it first (GHH finishes only active tasks), so an unassigned task becomes yours.

### Meta editing

- Show and edit `meta` on tasks (task editor, saved with Save/⌘S and covered by undo/redo) and on projects (saved on blur). The text layout is `key: value`, or `key:` followed by `  - item` lines for a list.
- Saves send only a `meta` patch for the changed keys (`null` removes a key), so editing other fields never touches meta. A malformed line is reported and nothing is sent; the project editor keeps the typed text.
- History names the meta keys an update set or removed.
- Requires a GHH with the `0002_meta` migration.

## 2026-09-29 — Caleb's dedicated GHH runtime

- Deploy the web UI from `CalWtr/ghh-webui` at `/home/caleb/services/ghh-webui`, served on port 8081 by a NixOS-defined service.
- Point first-time browser defaults and the Settings placeholder to the deployed GHH model's UUID on dedicated Relative port 2708; previously saved endpoints remain user-controlled in localStorage and need updating manually.
- Document the checkout, service names, and browser-origin requirements. NixOS declarations are staged without a switch.
