import { describe, expect, it } from 'vitest';

import { allowedWarehouse, homeWorkspace, navigationFor, webAccessFor } from './access';
import { workspaces } from './workspaces';

describe('webAccessFor', () => {
  it.each([
    ['admin', { moh: 'full', dcfp: 'full', warehouse: 'full' }, ['NMS', 'JMS']],
    ['moh', { moh: 'read', dcfp: 'read', warehouse: 'read' }, ['NMS', 'JMS']],
    ['dfcp', { dcfp: 'full' }, []],
    ['dcfp', { dcfp: 'full' }, []],
    ['jms', { warehouse: 'full' }, ['JMS']],
    ['nms', { warehouse: 'full' }, ['NMS']],
  ])('opens the right workspaces for %s', (role, workspacesFor, warehouses) => {
    const access = webAccessFor([role]);
    expect(access.workspaces).toEqual(workspacesFor);
    expect(access.warehouses).toEqual(warehouses);
    expect(access.noWorkspace).toBeNull();
  });

  it('gives the widest access any held role gives, workspace by workspace', () => {
    const access = webAccessFor(['moh', 'dfcp', 'jms']);
    expect(access.workspaces).toEqual({
      moh: 'read',
      dcfp: 'full',
      warehouse: 'full',
    });
    expect(access.warehouses).toEqual(['NMS', 'JMS']);
  });

  it('reads role names in any case', () => {
    expect(webAccessFor([' JMS ']).warehouses).toEqual(['JMS']);
  });

  it.each(['vht', 'hotspot manager', 'delivery agent', 'VHT'])(
    'gives %s no web workspace and points it to the mobile app',
    (role) => {
      const access = webAccessFor([role]);
      expect(access.workspaces).toEqual({});
      expect(access.noWorkspace).toBe('mobile');
    },
  );

  it('keeps a person holding only field roles out of the web', () => {
    expect(webAccessFor(['hotspot manager', 'vht', 'delivery agent']).noWorkspace).toBe('mobile');
  });

  it('says when no role opens the web', () => {
    for (const roles of [['registered user'], ['store incharge', 'other supplier'], []]) {
      expect(webAccessFor(roles).noWorkspace).toBe('unassigned');
    }
  });

  it('a web role outweighs a mobile one', () => {
    const access = webAccessFor(['vht', 'dfcp']);
    expect(access.noWorkspace).toBeNull();
    expect(access.workspaces).toEqual({ dcfp: 'full' });
  });

  it('keeps everything open while the roles are not known yet', () => {
    expect(webAccessFor(null).workspaces).toEqual({
      moh: 'full',
      dcfp: 'full',
      warehouse: 'full',
    });
  });
});

describe('homeWorkspace', () => {
  it('is the first workspace the person can act in', () => {
    expect(homeWorkspace(webAccessFor(['jms']))).toBe('warehouse');
    expect(homeWorkspace(webAccessFor(['moh']))).toBe('moh');
    expect(homeWorkspace(webAccessFor(['vht', 'dfcp']))).toBe('dcfp');
  });

  it('is null without a web workspace', () => {
    expect(homeWorkspace(webAccessFor(['hotspot manager']))).toBeNull();
  });
});

describe('allowedWarehouse', () => {
  it('keeps a JMS user on JMS whatever was asked for', () => {
    const access = webAccessFor(['jms']);
    expect(allowedWarehouse(access, 'NMS')).toBe('JMS');
    expect(allowedWarehouse(access, 'JMS')).toBe('JMS');
  });

  it('lets someone who oversees both switch', () => {
    expect(allowedWarehouse(webAccessFor(['moh']), 'JMS')).toBe('JMS');
  });
});

describe('navigationFor', () => {
  const ids = (nav: ReturnType<typeof navigationFor>) => nav.map((workspace) => workspace.id);
  const paths = (nav: ReturnType<typeof navigationFor>) =>
    nav.flatMap((workspace) =>
      workspace.sections.flatMap((section) =>
        section.items.flatMap((item) => item.pages.map((page) => page.path)),
      ),
    );

  it('keeps only the workspaces a role opens, marking those it may only look at', () => {
    const nav = navigationFor(workspaces, webAccessFor(['moh']), () => true);
    expect(ids(nav)).toEqual(['moh', 'dcfp', 'warehouse']);
    expect(nav.map((workspace) => workspace.readOnly)).toEqual([true, true, true]);
    expect(ids(navigationFor(workspaces, webAccessFor(['jms']), () => true))).toEqual([
      'warehouse',
    ]);
  });

  it('leaves out pages whose permission is missing, and items left with none', () => {
    const nav = navigationFor(workspaces, webAccessFor(['moh']), (code) => code === 'roles:read');
    expect(paths(nav)).toContain('/moh/users/roles');
    expect(paths(nav)).not.toContain('/moh/users');

    const without = navigationFor(workspaces, webAccessFor(['moh']), () => false);
    const mohItems = without[0]?.sections.flatMap((section) =>
      section.items.map((item) => item.id),
    );
    expect(mohItems).not.toContain('users');
  });
});
