BEGIN;

DELETE FROM role_permission rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.name = 'moh' AND p.name IN (
    'audit:read',
    'hotspots:all_districts',
    'hotspots:read',
    'hotspots:read_district',
    'inventory:read',
    'orders:all_stores',
    'orders:read',
    'reports:read',
    'roles:read',
    'users:read');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON r.name = 'moh' AND p.name = 'catalogue:manage'
ON CONFLICT DO NOTHING;

DELETE FROM role_permission rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.name IN ('nms', 'jms') AND p.name = 'reports:read';

COMMIT;
