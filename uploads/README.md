# GHH — General Human Harness

Task coordination between humans and agents: projects, tasks that people and
agents hand to each other, dependencies that gate work, an append-only event
history, and notifications. API only.

GHH is **Relative-owned**: the Relative model in this directory (`model.json`,
`submodels/`) is the application's executable map. Every request enters one
public port, is authenticated and routed by the graph, and every durable write
passes through the `Database` submodel, so the `store` view shows every change.
TypeScript scripts in `src/` implement the individual steps.

`ghh-schema-draft.md` is the original design; see [Differences from the
draft](#differences-from-the-draft) for where the implementation departs from it.

## How a request flows

```
POST /api/models/<model>/ports/api   (Authorization: Bearer <token>)
  -> Authenticate          reads the header endpoint, resolves the actor (401 otherwise)
  -> Router                picks the module by op prefix
  -> <Module>.Select       picks the operation
  -> <Operation>           validates, reads, and either replies (rejection)
                           or emits one WriteSet: rows + event rows + preconditions
  -> Database.Commit       applies it all-or-nothing under the write lock,
                           rechecks preconditions, stores the idempotency receipt
  -> <Module>.Finish write turns the commit result into the reply, and only
                           after a commit wakes consumers:
                             events  -> Notifications (route to inbox / webhooks)
                             intents -> Dependencies (task.unblocked)
  -> api return            the reply
```

Modules: Identity, Projects, Tasks, Dependencies, Query (all reads),
Notifications, Scheduler, Database. A 5-minute `tick` drives the deadline
scan (due soon, overdue, stale) and webhook retries.

Each operation is a one-function submodel. That is how Relative 0.10 executes
a chain: only the function a boundary arrival triggers runs, and only its
output drives a child submodel's callable pin, so every step sits behind its
own boundary.

## Setup

Requirements: Node ≥ 22.18 (runs `.ts` directly; `node:sqlite` is built in),
Relative ≥ 0.10.0.

```sh
npm install                     # dev tooling only (types, tests)
npm run bootstrap -- --admin-name "Caleb"
```

The bootstrap creates the SQLite database (`data/ghh.sqlite`, or
`GHH_DB_PATH`), applies migrations, and creates the `system` user and the
first admin. It prints the admin token once and refuses to run on a
non-empty database. Later schema upgrades: `POST /api/models/<model>/ports/migrate`
with `{}`.

Relative service settings GHH needs:

| Variable | Value | Why |
|---|---|---|
| `RELATIVE_HOST_HEADER_ALLOW` | `authorization` | Without it the header never reaches Authenticate and every call is 401. |
| `RELATIVE_EXTERNAL_ROOTS` | includes this directory's parent | The model is opened in place. |
| `GHH_DB_PATH` | optional | Database location; default `data/ghh.sqlite` here. |
| `RELATIVE_HOST` + `RELATIVE_API_TOKEN` | only for network exposure | The `api` port is `public`, so clients need only their GHH token; every other Relative route (model edits, traces, `migrate`) still needs Relative's own token. |

Then open the model (`POST /api/models {"openPath": "<this dir>"}`, or the MCP
`open_model`) and start it.

## Calling the API

```http
POST /api/models/<model-id>/ports/api
Authorization: Bearer ghh_...
Content-Type: application/json

{ "request_id": "<fresh UUIDv7>",
  "idempotency_key": "create-task-42",
  "command": { "op": "task.create", "args": { "project_id": "...", "name": "Write the adapter" } } }
```

- **Reply:** HTTP 200 `{ "emitted": true, "value": <ApiReply> }`. `value.ok`
  is `true` with `result`, or `false` with `error: { code, message, details? }`.
  Domain errors are carried in the reply, not the HTTP status.
- **Malformed requests** (unknown op, unknown field, wrong type) are rejected
  by Relative against the schema before the graph runs: HTTP 400
  `{ "error": "Value for port \"api\" does not match ..." }`.
- **Shapes:** `contracts/ghh.schema.json` is canonical; `src/types.ts` has the
  same shapes as TypeScript (`ArgsOf<'task.finish'>`, `ResultOf<...>`).
- **Versioned writes:** task writes carry `args.if_match` (the version you
  read); a mismatch is `version_conflict` and nothing is written.
- **Idempotency:** a repeated `idempotency_key` returns the original reply
  (with your new `request_id`); the same key on a different request is
  `invalid_request`.
- **Pagination:** list replies carry `next_after`; pass it back as `after`.
- **Tokens:** GHH never sees a token in a request body. To issue one, generate
  it yourself and send its SHA-256: `user.issue_token { user_id, token_sha256 }`
  (admins for anyone, everyone for themselves).

### Operations

| Module | Ops |
|---|---|
| Identity | `user.create`*, `user.update`, `user.delete`*, `user.issue_token` |
| Projects | `project.create`, `project.update`, `project.archive`, `project.delete`, `project.add_member`, `project.remove_member` |
| Tasks | `task.create`, `task.update`, `task.delete`, `task.clone`, `task.start`, `task.unclaim`, `task.finish`, `task.cancel`, `task.reopen`, `task.assign`, `task.handoff`, `task.add_note` |
| Dependencies | `dependency.add`, `dependency.remove` |
| Notifications | `subscription.create`, `subscription.delete`, `notification.mark_read` |
| Scheduler | `config.update`* |
| Query | `query.me`, `query.users`, `query.user`, `query.projects`, `query.project`, `query.members`, `query.project_graph`, `query.tasks`, `query.task`, `query.subtasks`, `query.dependencies`, `query.dependents`, `query.events`, `query.subscriptions`, `query.notifications`, `query.config` |

\* admin only. Project and task operations require project membership (admins
may act in any project); reads show only projects you belong to.

Error codes: `invalid_request`, `unauthenticated`, `forbidden`, `not_member`,
`not_found`, `version_conflict`, `invalid_transition`, `blocked`,
`dependency_cycle`, `open_subtasks`, `validation_failed`, `internal`.

### Webhooks

`subscription.create { channel: "webhook", url, secret, types, project_id?, only_mine? }`.
Each delivery is `POST <url>` with the event JSON as the body and:

- `X-GHH-Event-Id` — dedupe on it; a delivery can repeat.
- `X-GHH-Signature: sha256=<hex HMAC-SHA256 of the raw body with your secret>`

A non-2xx or a 10 s timeout is retried after ≥1 min, ≥5 min and ≥30 min
(picked up by the next 5-minute tick), then the delivery is marked failed.
The secret is never returned by any read.

## Behavior worth knowing

- A prerequisite blocks its dependents until it is **finished**; a canceled or
  deleted prerequisite keeps them blocked until the edge is removed.
- `task.start` claims an unassigned task; `task.unclaim` returns it to planned
  and unassigned. `task.reopen` keeps the outcome.
- Stale = active with no activity for `stale_after_hours` (project override
  first). The scheduler's own due/overdue/stale events are not activity, so
  each quiet stretch is announced once.
- Notifications never go to the actor of the event, only to members of its
  project; `only_mine` means the task's current assignee.

## Development

```sh
npm test                 # contract tests + end-to-end integration tests
npm run test:contracts   # schema/types only (fast)
npm run typecheck
npm run gen:types        # after editing contracts/ghh.schema.json
```

The integration tests start a disposable Relative service (default checkout
`/home/caleb/services/relative`, override with `GHH_RELATIVE_CHECKOUT`) on an
ephemeral port against a copy of the model and a scratch database, and call the
public `api` port like a client. `GHH_KEEP_IT=1` keeps the temp directory.

Model edits go through the Relative MCP (`relative` server), never by editing
`model.json` by hand.

## Differences from the draft

- **No REST routes.** The API is one port taking an `op` envelope; the draft's
  method/path table maps 1:1 onto ops. `If-Match` and `Idempotency-Key` are
  fields (`args.if_match`, `idempotency_key`), not headers; only
  `Authorization` is a header.
- **Status codes.** Domain errors come back in a 200 reply's `error.code`;
  only schema violations are HTTP 400.
- `task.finish` without an outcome is a schema error (400), not 422.
- Added `forbidden` (admin-only operations) and `internal` error codes, and
  `user.is_admin`.
- Cursors are opaque (`next_after`), because id order is wrong for due/updated
  sorts.

## Known limitations

- **Webhook delivery runs inside a graph run**, and Relative serializes runs
  per model. A slow receiver (up to the 10 s timeout) therefore delays other
  API calls while it is being delivered to. Fixing this needs delivery outside
  the run (for example a worker that reports results back through a port).
- **Retry timing** follows the 5-minute tick, so the 1-minute retry happens at
  the next tick.
- Each step is a separate Node process: a write takes roughly 0.5–1 s end to
  end.
