-- District focal persons stop creating field accounts; the accounts they made remain.
BEGIN;

DELETE FROM role_permission
WHERE permission_id IN (SELECT id FROM permissions WHERE name IN ('users:district_read', 'users:district_create'));
DELETE FROM permissions WHERE name IN ('users:district_read', 'users:district_create');

COMMIT;
