package rbac

import (
	"context"
	"errors"

	"clims-backend/internal/features/audit"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnknownPermission = errors.New("unknown permission")

var ErrAdminRole = errors.New("admin permissions cannot be changed")

// ErrRegisteredRole refuses permissions for the role public sign-up assigns: anyone can register, so
// whatever it held would be open to anyone.
var ErrRegisteredRole = errors.New("the registered user role is given to anyone who signs up, so it cannot hold permissions")

type Repository struct {
	DB    *pgxpool.Pool
	audit audit.Auditor
}

func NewRepository(db *pgxpool.Pool, auditor audit.Auditor) *Repository {
	return &Repository{DB: db, audit: auditor}
}

// rolePermissions lists a role's permission names in order, for its audit entry.
const rolePermissions = `SELECT coalesce(array_agg(p.name ORDER BY p.name), '{}')
	FROM role_permission rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`

func (r *Repository) ListRoles(ctx context.Context) ([]Role, error) {
	rows, err := r.DB.Query(ctx, `SELECT r.id, r.name, ARRAY(
SELECT p.name FROM role_permission rp JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role_id = r.id ORDER BY p.name) FROM roles r ORDER BY r.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := []Role{}
	for rows.Next() {
		var role Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Permissions); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (r *Repository) ListPermissions(ctx context.Context) ([]string, error) {
	rows, err := r.DB.Query(ctx, `SELECT name FROM permissions ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	codes := []string{}
	for rows.Next() {
		var code string
		if err = rows.Scan(&code); err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	return codes, rows.Err()
}

func (r *Repository) SetRolePermissions(ctx context.Context, id string, codes []string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var name string
	if err = tx.QueryRow(ctx, `SELECT name FROM roles WHERE id=$1 FOR UPDATE`, id).Scan(&name); err != nil {
		return err
	}
	var before []string
	if err = tx.QueryRow(ctx, rolePermissions, id).Scan(&before); err != nil {
		return err
	}
	if name == AdminRoleName {
		return ErrAdminRole
	}
	if id == RegisteredUserRoleID && len(codes) > 0 {
		return ErrRegisteredRole
	}
	var unknown bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM unnest($1::text[]) AS requested(name)
		WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.name = requested.name)
	)`, codes).Scan(&unknown); err != nil {
		return err
	}
	if unknown {
		return ErrUnknownPermission
	}
	if _, err = tx.Exec(ctx, `DELETE FROM role_permission WHERE role_id=$1 AND permission_id NOT IN (SELECT id FROM permissions WHERE name = ANY($2::text[]))`, id, codes); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO role_permission (role_id, permission_id)
		SELECT $1, id FROM permissions WHERE name = ANY($2) ON CONFLICT DO NOTHING`, id, codes); err != nil {
		return err
	}
	var after []string
	if err = tx.QueryRow(ctx, rolePermissions, id).Scan(&after); err != nil {
		return err
	}
	if changes := audit.Diff(map[string]any{"permissions": before}, map[string]any{"permissions": after}); len(changes) > 0 {
		if err = r.audit.Record(ctx, tx, audit.Entry{Action: "role.permissions_changed",
			Target: &audit.Subject{Type: "role", ID: id}, Changes: changes,
			Details: map[string]any{"role": name}}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
