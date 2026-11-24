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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCan } from '@/features/auth/queries';
import { formatNumber } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import {
  CATALOGUE_PERMISSION,
  categoryLabel,
  isComplete,
  packLabel,
  productName,
  type Product,
} from './api';
import { ProductFormDialog } from './ProductFormDialog';
import { useDeleteProduct, useLookups, useProducts, useSetProductActive } from './queries';
import { activeFilters, filterFrom, statusHref, type StatusFilter } from './statusFilters';

const FILTERS: readonly StatusFilter<Product>[] = [
  ...activeFilters<Product>(),
  { value: 'incomplete', label: 'Incomplete', keeps: (product) => !isComplete(product) },
];

type Dialog = { kind: 'add' } | { kind: 'edit'; product: Product } | null;

/** Names a product's row actions; the pack tells apart products that differ only by unit. */
function actionsLabel(product: Product): string {
  const pack = packLabel(product);
  return `Actions for ${productName(product)}${pack ? ` (${pack})` : ''}`;
}

/**
 * Condom products: one entry per brand, category, type and unit. The MOH and
 * warehouse workspaces both show it; changes need `catalogue:manage` and a
 * workspace the person may act in.
 */
export default function ProductsPage() {
  const products = useProducts();
  const types = useLookups('types');
  const brands = useLookups('brands');
  const units = useLookups('units');
  const setActive = useSetProductActive();
  const deleteProduct = useDeleteProduct();
  const can = useCan();
  const readOnly = useReadOnly();
  const canManage = can(CATALOGUE_PERMISSION) && !readOnly;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // Each row's actions button, so a dialog opened from its menu can hand focus back to it.
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());

  const filter = filterFrom(FILTERS, searchParams.get('status'));
  const rows = useMemo(() => products.data?.filter(filter.keeps), [products.data, filter]);
  const incomplete = products.data?.filter((product) => !isComplete(product)).length ?? 0;
  const tabs = FILTERS.filter((option) => option.value !== 'incomplete' || incomplete > 0);

  /** Sends focus back to a row's actions button as a dialog closes, if the row is still shown. */
  function focusRowActions(productId: string, event: Event) {
    const button = actionButtons.current.get(productId);
    if (!button?.isConnected) return;
    event.preventDefault();
    button.focus();
  }

  const columns = useMemo<DataTableColumn<Product>[]>(
    () => [
      {
        id: 'brand',
        filter: 'select',
        header: 'Brand',
        value: (product) => product.brand?.name ?? null,
        cell: (product) => (
          <span
            className="block max-w-40 truncate font-medium sm:max-w-64"
            title={product.brand?.name}
          >
            {product.brand?.name ?? '—'}
          </span>
        ),
      },
      {
        id: 'category',
        filter: 'select',
        header: 'Category',
        value: (product) => (product.category ? categoryLabel(product.category) : null),
      },
      {
        id: 'type',
        filter: 'select',
        header: 'Type',
        value: (product) => product.type?.name ?? null,
      },
      {
        id: 'unit',
        filter: 'select',
        header: 'Unit',
        value: (product) => product.unit?.name ?? null,
      },
      {
        id: 'per',
        header: 'Condoms per unit',
        numeric: true,
        value: (product) => product.pieces_per_unit,
        cell: (product) =>
          product.pieces_per_unit === null ? '—' : formatNumber(product.pieces_per_unit),
      },
      {
        id: 'status',
        filter: 'select',
        header: 'Status',
        value: (product) =>
          [product.active ? 'Active' : 'Inactive', isComplete(product) ? null : 'Incomplete']
            .filter(Boolean)
            .join(', '),
        cell: (product) => (
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge
              status={product.active ? 'Active' : 'Inactive'}
              tone={product.active ? 'positive' : 'neutral'}
            />
            {isComplete(product) ? null : <StatusBadge status="Incomplete" tone="caution" />}
          </div>
        ),
      },
    ],
    [],
  );

  function rowActions(product: Product): RowActionItem[] {
    const complete = isComplete(product);
    const actions: RowActionItem[] = [
      {
        label: complete ? 'Edit' : 'Complete details',
        icon: Pencil,
        onSelect: () => {
          setDialog({ kind: 'edit', product });
        },
      },
    ];
    if (product.active) {
      actions.push({
        label: 'Deactivate',
        icon: Ban,
        onSelect: () => {
          setActive.mutate({ product, active: false });
        },
      });
    } else if (complete) {
      // An incomplete product is completed in the form before it can be activated.
      actions.push({
        label: 'Activate',
        icon: CircleCheck,
        onSelect: () => {
          setActive.mutate({ product, active: true });
        },
      });
    }
    actions.push(ROW_ACTION_SEPARATOR, {
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => {
        setProductToDelete(product);
      },
    });
    return actions;
  }

  const addButton = canManage ? (
    <Button
      onClick={() => {
        setDialog({ kind: 'add' });
      }}
    >
      <Plus data-icon="inline-start" />
      Add product
    </Button>
  ) : null;

  const filtered = filter.value !== 'all';
  return (
    <div className="gap-section flex flex-col">
      <PageActions>
        <ExportButton name="Products" columns={columns} rows={rows} />
        {addButton}
      </PageActions>
      {canManage && incomplete > 0 ? (
        <Alert variant="warning">
          <AlertTitle>
            {incomplete === 1
              ? '1 product is missing details'
              : `${formatNumber(incomplete)} products are missing details`}
          </AlertTitle>
          <AlertDescription>
            Products from the previous system can lack a brand, type, unit or pack size. Complete
            their details before editing or reactivating them.
          </AlertDescription>
        </Alert>
      ) : null}
      <FilterTabs
        label="Filter products by status"
        value={filter.value}
        hrefFor={(value) => statusHref(pathname, value)}
        tabs={tabs.map((option) => ({
          value: option.value,
          label: option.label,
          ...(products.data ? { count: products.data.filter(option.keeps).length } : {}),
        }))}
      />
      <DataTable
        label="Products"
        preferencesKey="catalogue-products"
        columns={columns}
        rows={rows}
        getRowId={(product) => product.id}
        isLoading={products.isPending}
        error={products.error}
        onRetry={() => void products.refetch()}
        isRetrying={products.isRefetching}
        searchPlaceholder="Search products…"
        emptyTitle={filtered ? `No ${filter.label.toLowerCase()} products` : 'No products yet'}
        emptyDescription={
          filtered
            ? 'Choose All to see every product.'
            : 'Add the condom products that are stocked, ordered and distributed.'
        }
        emptyAction={filtered ? undefined : addButton}
        rowActions={
          canManage
            ? (product) => (
                <RowActions
                  label={actionsLabel(product)}
                  triggerRef={(button) => {
                    if (button) actionButtons.current.set(product.id, button);
                    else actionButtons.current.delete(product.id);
                  }}
                  actions={rowActions(product)}
                />
              )
            : undefined
        }
      />
      {dialog ? (
        <ProductFormDialog
          key={dialog.kind === 'edit' ? dialog.product.id : 'add'}
          product={dialog.kind === 'edit' ? dialog.product : undefined}
          types={types}
          brands={brands}
          units={units}
          onClose={() => {
            setDialog(null);
          }}
          onCloseAutoFocus={
            dialog.kind === 'edit'
              ? (event) => {
                  focusRowActions(dialog.product.id, event);
                }
              : undefined
          }
        />
      ) : null}
      <ConfirmDialog
        open={productToDelete !== null}
        onOpenChange={(open) => {
          if (open) return;
          setProductToDelete(null);
          deleteProduct.reset();
        }}
        title={productToDelete ? `Delete ${productName(productToDelete)}?` : 'Delete product?'}
        description="This permanently removes the product from the catalogue. Products linked to stock or order records cannot be deleted; deactivate them instead."
        confirmLabel="Delete product"
        isPending={deleteProduct.isPending}
        error={deleteProduct.error}
        onConfirm={() => {
          if (!productToDelete) return;
          deleteProduct.mutate(productToDelete, {
            onSuccess: () => {
              setProductToDelete(null);
            },
          });
        }}
      />
    </div>
  );
}
