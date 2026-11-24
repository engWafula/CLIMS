BEGIN;

-- The Ministry of Health oversees the whole programme: it reads everything (every store, district,
-- hotspot, order, report, user and the audit log) and changes nothing (decided 2026-11-24). Until now
-- the moh role held only catalogue:manage, so MOH accounts could open almost no screen.
--
-- Default grants, which administrators can still change in Users & access. orders:all_stores and
-- hotspots:all_districts widen what the read permissions show to every store and district; they add
-- no action, because moh holds no write permission.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON r.name = 'moh' AND p.name IN (
        'audit:read',
        'hotspots:all_districts',
        'hotspots:read',
        'hotspots:read_district',
        'inventory:read',
        'orders:all_stores',
        'orders:read',
        'reports:read',
        'roles:read',
        'users:read')
ON CONFLICT DO NOTHING;

-- Read-only: migration 18 gave moh catalogue:manage, its one write permission.
DELETE FROM role_permission rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.name = 'moh' AND p.name = 'catalogue:manage';

-- The national warehouses read the reports on their own store (warehouse requests, stock, batches
-- and expiry); without orders:all_stores the server keeps them to it.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON r.name IN ('nms', 'jms') AND p.name = 'reports:read'
ON CONFLICT DO NOTHING;

COMMIT;
