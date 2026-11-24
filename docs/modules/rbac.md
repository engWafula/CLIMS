# RBAC module

[Module architecture](README.md) · [OpenAPI contract](../api/openapi.json)

Source: `backend/internal/features/rbac/`.

| File            | Responsibility                                                       |
| --------------- | -------------------------------------------------------------------- |
| `model.go`      | Role IDs, names, and permission lists                                |
| `dto.go`        | Complete permission-set replacement request                          |
| `repository.go` | Role/permission catalog queries and transactional permission updates |
| `middleware.go` | `PermissionHolder`, principal-local key, and permission gate         |
| `handler.go`    | Catalog responses, permission updates, and error handling            |
| `routes.go`     | Role and permission routes                                           |

## Role catalog

The role catalog includes `admin`, `moh`, `nms`, `jms`, `dfcp`, `store incharge`, `hotspot manager`, `delivery agent`, `other supplier`, `healthy facility`, and `vht`. The API returns UUIDs for these roles. It supports permission updates for existing roles.

`moh` is the national overseer: it reads everything and changes nothing. Migration 39 grants it every read permission with `orders:all_stores` and `hotspots:all_districts` (which widen what it reads to every store and district, and add no action), and removes `catalogue:manage`. The web app opens every workspace read-only for it. These are default grants an administrator can change on Roles & permissions.

## Permission policy

| Permission          | Capability                                           |
| ------------------- | ---------------------------------------------------- |
| `users:read`        | List and read account records                        |
| `users:create`      | Create accounts, together with `roles:assign`        |
| `users:update`      | Activate or disable accounts                         |
| `roles:read`        | List roles and available permission codes            |
| `roles:assign`      | Assign user roles, including admin                   |
| `roles:manage`      | Replace a non-admin role's permissions               |
| `orders:read`       | List and view orders involving the assigned store    |
| `orders:all_stores` | Apply the account’s orders permissions to all stores |

The admin role receives all seeded permissions. Administrators grant access to other roles through the permissions endpoint. An active account can read its own profile regardless of its role.

`roles:assign` and `roles:manage` are delegation powers: a holder can grant broad access, including administrator-level access. They are intended for trusted account administrators.

## Routes and middleware

| Method | Route                            | Required permission |
| ------ | -------------------------------- | ------------------- |
| GET    | `/api/v1/roles`                  | `roles:read`        |
| GET    | `/api/v1/permissions`            | `roles:read`        |
| PUT    | `/api/v1/roles/{id}/permissions` | `roles:manage`      |

All routes require a valid JWT and an active account. `RequirePermission` reads `PermissionHolder` from the current-user local and returns 403 unless the permission is present. RBAC does not import auth or users; users implements the interface.

Permission replacement takes a role-row lock, removes mappings absent from the request and inserts new mappings, and commits as one transaction. Invalid codes roll back the entire update with 422. Duplicates are ignored. An empty array revokes all management permissions. Missing or null `permissions` is rejected, and requests are limited to 100 entries.

The admin role's permissions are immutable through this API; attempts to change them return 409. The users module separately protects the last active administrator from demotion or disabling. Protected requests reload account permissions from PostgreSQL, so a role or permission change affects the next request even with an existing JWT.

## Schema migration

Migration 3 backfills legacy user assignments and existing permission grants into `role_user` and `role_permission`. Migration 4 promotes the existing user and role UUIDs to primary keys and points both joins to those keys. Permissions have UUID primary keys and unique names. The joins have composite UUID primary keys and timestamps.

Authorization uses the union of all assigned roles’ permissions. The legacy import copies recognized role assignments into `role_user`. The admin role is identified by its unique name for provisioning and protection.
