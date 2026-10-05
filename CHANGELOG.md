# Changelog

## Unreleased — Finishing tasks

- A finished task shows its outcome as an editable field, saved with the other edits (Save/⌘S, undo/redo). It cannot be emptied. Needs GHH with outcome on `task.update`.
- The outcome field is multi-line, and the shown outcome keeps its line breaks.
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
