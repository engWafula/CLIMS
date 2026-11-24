-- A district focal person creates the accounts of the field workers in their own district: VHTs,
-- hotspot managers and delivery agents, and no other role (POST /users/district). They see those
-- accounts (GET /users/district). The general users:create and roles:assign stay with
-- administrators, since they would let a DCFP hand out any role to anyone.
BEGIN;

INSERT INTO permissions (name, description) VALUES
    ('users:district_read', 'See the VHT, hotspot manager and delivery agent accounts in their own district'),
    ('users:district_create', 'Create VHT, hotspot manager and delivery agent accounts in their own district')
ON CONFLICT (name) DO NOTHING;

-- The district focal person role exists for this work ('dfcp' and 'dcfp' are both in use), so it
-- holds the permissions from the start, as admin does; other roles receive them through the RBAC API.
INSERT INTO role_permission (role_id, permission_id)
SELECT roles.id, permissions.id FROM roles CROSS JOIN permissions
WHERE lower(roles.name) IN ('admin', 'dfcp', 'dcfp')
    AND permissions.name IN ('users:district_read', 'users:district_create')
ON CONFLICT DO NOTHING;

COMMIT;
