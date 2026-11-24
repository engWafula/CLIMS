'use client';

import { Ban, CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import {
  ROW_ACTION_SEPARATOR,
  RowActions,
  type RowActionItem,
} from '@/components/data-table/RowActions';
import { ExportButton } from '@/components/ExportButton';
import { FilterTabs } from '@/components/FilterTabs';
import { PageActions } from '@/components/PageActions';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/features/auth/queries';
import { formatNumber } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import { CATALOGUE_PERMISSION, type Lookup, type LookupKind } from './api';
import { LookupFormDialog } from './LookupFormDialog';
import { LOOKUP_TEXT } from './lookupKinds';
import { useDeleteLookup, useLookups, useSetLookupActive } from './queries';
import { activeFilters, filterFrom, statusHref } from './statusFilters';

const FILTERS = activeFilters<Lookup>();

type Dialog = { kind: 'add' } | { kind: 'edit'; lookup: Lookup } | null;

interface LookupsPageProps {
  kind: LookupKind;
}

/**
 * The list of product types, brands or units of measure: they share their shape,
 * rules and actions. Changes need `catalogue:manage` and a workspace the person
 * may act in.
 */
export function LookupsPage({ kind }: LookupsPageProps) {
  const text = LOOKUP_TEXT[kind];
  const { heading } = text;
  const lookups = useLookups(kind);
  const setActive = useSetLookupActive(kind);
  const deleteLookup = useDeleteLookup(kind);
  const can = useCan();
  const readOnly = useReadOnly();
  const canManage = can(CATALOGUE_PERMISSION) && !readOnly;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [lookupToDelete, setLookupToDelete] = useState<Lookup | null>(null);
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());

  const filter = filterFrom(FILTERS, searchParams.get('status'));
  const rows = useMemo(() => lookups.data?.filter(filter.keeps), [lookups.data, filter]);

  function focusRowActions(id: string, event: Event) {
    const button = actionButtons.current.get(id);
    if (!button?.isConnected) return;
    event.preventDefault();
    button.focus();
  }

  const columns = useMemo<DataTableColumn<Lookup>[]>(
    () => [
      {
        id: 'name',
        header: heading,
        value: (lookup) => lookup.name,
        cell: (lookup) => (
          <div className="max-w-40 min-w-0 sm:max-w-52 xl:max-w-80">
            <div className="truncate font-medium" title={lookup.name}>
              {lookup.name}
            </div>
            {lookup.note ? (
              <div className="text-muted-foreground truncate text-xs" title={lookup.note}>
                {lookup.note}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'products',
        header: 'Used by',
        numeric: true,
        value: (lookup) => lookup.product_count,
        cell: (lookup) =>
          `${formatNumber(lookup.product_count)} product${lookup.product_count === 1 ? '' : 's'}`,
      },
      {
        id: 'status',
        filter: 'select',
        header: 'Status',
        value: (lookup) => (lookup.active ? 'Active' : 'Inactive'),
        cell: (lookup) => (
          <StatusBadge
            status={lookup.active ? 'Active' : 'Inactive'}
            tone={lookup.active ? 'positive' : 'neutral'}
          />
        ),
      },
    ],
    [heading],
  );

  function rowActions(lookup: Lookup): RowActionItem[] {
    const actions: RowActionItem[] = [
      {
        label: 'Edit',
        icon: Pencil,
        onSelect: () => {
          setDialog({ kind: 'edit', lookup });
        },
      },
      lookup.active
        ? {
            label: 'Deactivate',
            icon: Ban,
            onSelect: () => {
              setActive.mutate({ lookup, active: false });
            },
          }
        : {
            label: 'Activate',
            icon: CircleCheck,
            onSelect: () => {
              setActive.mutate({ lookup, active: true });
            },
          },
    ];
    if (!lookup.in_use) {
      actions.push(ROW_ACTION_SEPARATOR, {
        label: 'Delete',
        icon: Trash2,
        destructive: true,
        onSelect: () => {
          setLookupToDelete(lookup);
        },
      });
    }
    return actions;
  }

  const addButton = canManage ? (
    <Button
      onClick={() => {
        setDialog({ kind: 'add' });
      }}
    >
      <Plus data-icon="inline-start" />
      Add {text.singular}
    </Button>
  ) : null;

  const filtered = filter.value !== 'all';
  return (
    <div className="gap-section flex flex-col">
      <PageActions>
        <ExportButton name={text.title} columns={columns} rows={rows} />
        {addButton}
      </PageActions>
      <FilterTabs
        label={`Filter ${text.plural} by status`}
        value={filter.value}
        hrefFor={(value) => statusHref(pathname, value)}
        tabs={FILTERS.map((option) => ({
          value: option.value,
          label: option.label,
          ...(lookups.data ? { count: lookups.data.filter(option.keeps).length } : {}),
        }))}
      />
      <DataTable
        label={text.title}
        preferencesKey={`catalogue-${kind}`}
        columns={columns}
        rows={rows}
        getRowId={(lookup) => lookup.id}
        isLoading={lookups.isPending}
        error={lookups.error}
        onRetry={() => void lookups.refetch()}
        isRetrying={lookups.isRefetching}
        searchPlaceholder={`Search ${text.plural}…`}
        emptyTitle={
          filtered ? `No ${filter.label.toLowerCase()} ${text.plural}` : `No ${text.plural} yet`
        }
        emptyDescription={filtered ? 'Choose All to see every one.' : text.emptyDescription}
        emptyAction={filtered ? undefined : addButton}
        rowActions={
          canManage
            ? (lookup) => (
                <RowActions
                  label={`Actions for ${lookup.name}`}
                  triggerRef={(button) => {
                    if (button) actionButtons.current.set(lookup.id, button);
                    else actionButtons.current.delete(lookup.id);
                  }}
                  actions={rowActions(lookup)}
                />
              )
            : undefined
        }
      />
      {dialog ? (
        <LookupFormDialog
          key={dialog.kind === 'edit' ? dialog.lookup.id : 'add'}
          kind={kind}
          lookup={dialog.kind === 'edit' ? dialog.lookup : undefined}
          onClose={() => {
            setDialog(null);
          }}
          onCloseAutoFocus={
            dialog.kind === 'edit'
              ? (event) => {
                  focusRowActions(dialog.lookup.id, event);
                }
              : undefined
          }
        />
      ) : null}
      <ConfirmDialog
        open={lookupToDelete !== null}
        onOpenChange={(open) => {
          if (open) return;
          setLookupToDelete(null);
          deleteLookup.reset();
        }}
        title={lookupToDelete ? `Delete ${lookupToDelete.name}?` : `Delete ${text.singular}?`}
        description="It is removed from the catalogue for good. This cannot be undone."
        confirmLabel={`Delete ${text.singular}`}
        isPending={deleteLookup.isPending}
        error={deleteLookup.error}
        onConfirm={() => {
          if (!lookupToDelete) return;
          deleteLookup.mutate(lookupToDelete, {
            onSuccess: () => {
              setLookupToDelete(null);
            },
          });
        }}
      />
    </div>
  );
}
