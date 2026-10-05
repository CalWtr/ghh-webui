# Changelog

## Unreleased — Task fields

- Admin → Task fields edits the instance preset fields (key, level, kind, description, default); a project's Task fields section edits its own, lists the instance fields it inherits, and can Override one (change it, or set it to off). Saves send only the changed definitions. Needs GHH with `0004_fields`.
- The task editor shows each field that applies as its own labeled input (lists one item per line) with its level and description; unset required fields are highlighted. "Other meta" holds the remaining keys, and a field key typed there is refused. Both save as one meta patch.
- Under the Start/Finish buttons, a hint names the unset fields each needs. Finish (including Start-then-Finish on a planned task) is checked before anything is sent, so a planned task is not left started when finishing would be refused.
- History names field definitions a project update set or removed.

## Unreleased — Finishing tasks

- The outcome is the finish result: a read-only OUTCOME card shows on finished tasks only, and the task editor never sends `outcome`. Set it in the Finish panel (multi-line, starts empty); to change it, Reopen (which clears it) and finish again. Needs GHH with `0003_outcome_finished_only`; expected results go in the description.
- The shown outcome keeps its line breaks.
- Planned tasks offer Finish as well as Start; finishing one starts it first (GHH finishes only active tasks), so an unassigned task becomes yours.

## Unreleased — Meta editing

- Show and edit `meta` on tasks (task editor, saved with Save/⌘S and covered by undo/redo) and on projects (saved on blur). The text layout is `key: value`, or `key:` followed by `  - item` lines for a list.
- Saves send only a `meta` patch for the changed keys (`null` removes a key), so editing other fields never touches meta. A malformed line is reported and nothing is sent; the project editor keeps the typed text.
- History names the meta keys an update set or removed.
- Requires a GHH with the `0002_meta` migration.

## 2026-09-29 — Caleb's dedicated GHH runtime

- Deploy the web UI from `CalWtr/ghh-webui` at `/home/caleb/services/ghh-webui`, served on port 8081 by a NixOS-defined service.
- Point first-time browser defaults and the Settings placeholder to the deployed GHH model's UUID on dedicated Relative port 2708; previously saved endpoints remain user-controlled in localStorage and need updating manually.
- Document the checkout, service names, and browser-origin requirements. NixOS declarations are staged without a switch.
