import { Eye, Smartphone, UserRoundX } from 'lucide-react';

import { STORE_LABELS } from '@/features/warehouse/paths';
import { accessTo, webAccessFor, WORKSPACE_ORDER } from '@/navigation/access';
import { workspaces } from '@/navigation/workspaces';

/**
 * Which web workspaces holding `roleNames` opens, by the same rules the app
 * applies at sign-in (`navigation/access.ts`), so what an administrator reads
 * here is what that person will see.
 */
export function WebAccessList({ roleNames }: { roleNames: readonly string[] }) {
  const access = webAccessFor(roleNames);
  if (access.noWorkspace) {
    const mobile = access.noWorkspace === 'mobile';
    const Icon = mobile ? Smartphone : UserRoundX;
    return (
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {mobile
          ? 'Works only in the mobile app. Web sign-in refuses them and points them to it.'
          : 'No role of theirs opens a web workspace, so they see a notice after signing in.'}
      </p>
    );
  }
  return (
    <ul className="divide-border flex flex-col divide-y rounded-lg border">
      {WORKSPACE_ORDER.flatMap((id) => {
        const level = accessTo(access, id);
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (!level || !workspace) return [];
        const Icon = workspace.icon;
        const warehouses =
          id === 'warehouse' && access.warehouses.length > 0
            ? access.warehouses.map((code) => STORE_LABELS[code]).join(' and ')
            : null;
        return [
          <li key={id} className="flex items-center gap-3 px-3 py-2">
            <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{workspace.label}</span>
              {warehouses ? (
                <span className="text-muted-foreground block text-xs">{warehouses}</span>
              ) : null}
            </span>
            {level === 'read' ? (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Eye className="size-3.5" aria-hidden="true" />
                Read-only
              </span>
            ) : (
              <span className="text-success text-xs font-medium">Full access</span>
            )}
          </li>,
        ];
      })}
    </ul>
  );
}
