# Audit log

[Module architecture](README.md) · [Design decision](../adr/0003-audit-log.md)

The audit log records who did what, to which record, when and from where. Entries cannot be changed or deleted, and they outlive the accounts they mention.

## What an entry holds

- **Actor:** the signed-in user's ID with a copy of their username and roles at that moment, or a named `system_actor` for an automated job or command.
- **Action:** `<domain>.<event>`, such as `auth.login_failed`.
- **Outcome:** `success` or `failure`, with a `reason` for failures.
- **Target and related records (`subjects`):** the record acted on and the other records the action concerns. Searching by a subject returns entries where it is the target or a related record, which isolates the history of one hotspot, order, district, store or user. Search results give each user record its current `name` (the username) for display; the entry itself stores only the ID, so a deleted account's name is null.
- **Changes:** for data changes, only the fields that changed, before and after.
- **Details:** other facts, such as the identifier typed at a failed login.
- **Context:** the client's IP address, user agent, request ID (matching the server log line) and session.

Passwords, password hashes and tokens are never recorded. `audit.Diff` and the details writer drop any field whose name contains a word such as `password`, `token`, `secret` or `hash`.

## Recorded today

| Action                          | When                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `auth.registered`               | Public sign-up; the new account is the actor                            |
| `user.created`                  | An administrator, or `cmd/create-admin`, creates an account             |
| `auth.login_succeeded`          | A login starts a session                                                |
| `auth.login_failed`             | Wrong password, unknown or ambiguous identifier, or a disabled account  |
| `auth.refresh_location_changed` | A session is refreshed from a new IP address or device                  |
| `auth.refresh_replayed`         | A used refresh token is presented again; the session is revoked         |
| `auth.refresh_refused`          | A refresh with an invalid token, an ended session or a disabled account |
| `auth.logged_out`               | A user signs out                                                        |
| `auth.session_revoked`          | A user ends one of their other sessions                                 |
| `audit.searched`                | Someone searches the audit log, with the filters they used              |
| `user.roles_changed`            | An administrator changes a user's roles, before and after               |
| `user.disabled`                 | An administrator disables an account, with the sessions it ended        |
| `user.enabled`                  | An administrator re-enables an account                                  |
| `user.store_assigned`           | A user's store changes; the old and new stores are related records      |
| `user.sessions_revoked`         | An administrator or identity sync signs a user out everywhere           |
| `user.identity_linked`          | The identity sync client links an SSO identity to an account            |
| `role.permissions_changed`      | A role's permissions are replaced, before and after                     |
| `access.denied`                 | A data-changing request is refused for a missing permission             |
| `hotspot.<step>`                | Any hotspot step (see below), with what changed and the district        |
| `order.created`                 | A generic order is placed                                               |
| `order.fulfilled`               | A generic order is fulfilled                                            |
| `order.requested`               | A DCFP requests stock from a warehouse                                  |
| `order.reviewed`                | A warehouse reviews a request                                           |
| `order.stock_checked`           | A warehouse reserves stock for a request, or holds it                   |
| `order.dispatched`              | A warehouse ships a request, with the quantity issued                   |
| `order.received`                | A district receives a shipment, with the quantity counted               |
| `stockout.reported`             | A hotspot reports a stockout to its district store                      |
| `inventory.movement_recorded`   | Stock is adjusted at a store, with the reason and resulting balance     |
| `<item>.created`                | A catalogue item is added (see below)                                   |
| `<item>.updated`                | A catalogue item changes; saving it unchanged records nothing           |
| `<item>.deleted`                | A catalogue item is deleted, keeping what it was                        |

Routine token refreshes are not recorded; they would dominate the log.

Access changes are recorded only when something changed: saving the same roles, status or store again adds nothing. Refused reads (`GET`) are not recorded as `access.denied`; listing screens would flood the log. The identity sync client is recorded as the system actor `identity-sync:<client>`.

The hotspot steps are `submitted`, `updated`, `resubmitted`, `commented`, `activated`, `rejected` and `deactivated`; a DCFP's decision and a comment keep its text. Catalogue items are a `product`, `brand`, `product_type` or `unit_of_measure`. Order entries can be found under the order, both stores, the product and any hotspot; stock moved by a dispatch or receipt is part of the order's entry. Changes never include `created_at` or `updated_at`.

## Recording from a feature

Depend on the `audit.Auditor` interface, passed in from `cmd/server/main.go`.

- Call `Record(ctx, tx, entry)` inside the transaction of a successful change. The entry is saved only if the change commits.
- Call `RecordNow(ctx, entry)` for a failure or refusal that changes nothing.
- Pass the request's `c.Context()`. `audit.Middleware` has attached the actor, address, device, request ID and session, so an entry only describes what happened.

```go
err := r.audit.Record(ctx, tx, audit.Entry{
	Action:  "hotspot.activated",
	Target:  &audit.Subject{Type: "hotspot", ID: hotSpotID},
	Related: []audit.Subject{{Type: "district", ID: districtID}},
	Changes: audit.Diff(before, after),
})
```

Name actions `<domain>.<event>` and keep them as constants in the feature. Add them to the table above. Work done without a signed-in person, such as a command, runs with `audit.WithSystemActor(ctx, "job-name")`.

## Searching

`GET /api/v1/audit` returns entries newest first. It requires the `audit:read` permission, which migration 29 grants to `admin`; grant it to auditors through the RBAC API. Every search is itself recorded as `audit.searched`.

| Filter                        | Matches                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `actor_id`                    | Entries by one user                                                                 |
| `action`                      | One action, e.g. `auth.login_failed`                                                |
| `domain`                      | Actions in these domains (before the dot), comma-separated, e.g. `user,role`        |
| `exclude_domain`              | Leaves out these domains, comma-separated, e.g. `audit` to hide searches of the log |
| `outcome`                     | `success` or `failure`                                                              |
| `subject_type` + `subject_id` | Entries whose target or related records include that record                         |
| `from`, `to`                  | A date (`2026-11-21`, from its start in UTC) or an RFC 3339 time; `to` is exclusive |
| `limit` (max 100), `offset`   | Pagination                                                                          |

## Storage and protection

`audit_log` holds the entries and `audit_log_subjects` the target and related records, indexed for searching by actor, action, subject and time. Database triggers refuse every `UPDATE`, `DELETE` and `TRUNCATE` on both tables, including from the application's own database user; only a database owner who drops the triggers could change entries. Entries have no foreign key to `users`, so deleting an account keeps its history. Entries are kept indefinitely.
