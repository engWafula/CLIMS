'use client';

import { Copy, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { ExportButton } from '@/components/ExportButton';
import { PageActions } from '@/components/PageActions';
import { copyText } from '@/lib/copyText';
import { formatNumber } from '@/lib/format';

import { storeKindLabel, type Store } from './api';
import { useStores } from './queries';

const USERS_PATH = '/moh/users';

function storeSubtitle(store: Store): string {
  if (store.kind === 'national') return 'National warehouse';
  return store.region ? `${store.region} region` : (store.district ?? 'District store');
}

function stockLabel(stock: Store['on_hand'][number]): string {
  const category =
    stock.category === 'male' ? 'Male' : stock.category === 'female' ? 'Female' : 'Unclassified';
  return `${category}: ${formatNumber(stock.quantity)} ${stock.unit}`;
}

/** Live national warehouses and district stores, with physical stock in its recorded units. */
export default function StoresPage() {
  const stores = useStores();
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Store>[]>(
    () => [
      {
        id: 'name',
        header: 'Store',
        value: (store) => store.name,
        cell: (store) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{store.name}</div>
            <div className="text-muted-foreground truncate text-xs">{storeSubtitle(store)}</div>
          </div>
        ),
      },
      {
        id: 'kind',
        filter: 'select',
        header: 'Type',
        value: (store) => storeKindLabel(store.kind),
      },
      {
        id: 'code',
        header: 'Code',
        value: (store) => store.code,
        cell: (store) => <span className="font-mono text-xs">{store.code}</span>,
      },
      {
        id: 'users',
        header: 'Users',
        numeric: true,
        value: (store) => store.user_count,
        cell: (store) => formatNumber(store.user_count),
      },
      {
        id: 'stock',
        header: 'On hand',
        value: (store) => store.on_hand.map(stockLabel).join('; ') || 'No stock',
        cell: (store) => (
          <span className="flex flex-col tabular-nums">
            {store.on_hand.length === 0
              ? 'No stock'
              : store.on_hand.map((stock) => (
                  <span key={`${stock.category}:${stock.unit_id}`}>{stockLabel(stock)}</span>
                ))}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="gap-section flex flex-col">
      <p className="text-muted-foreground text-sm">
        Physical stock in its recorded units, including reserved and expired stock. User counts
        include everyone assigned to each store.
      </p>
      <PageActions>
        <ExportButton name="Stores" columns={columns} rows={stores.data} />
      </PageActions>
      <DataTable
        label="Stores"
        preferencesKey="stores"
        columns={columns}
        rows={stores.data}
        getRowId={(store) => store.id}
        isLoading={stores.isPending}
        error={stores.error}
        onRetry={() => void stores.refetch()}
        isRetrying={stores.isRefetching}
        searchPlaceholder="Search stores…"
        emptyTitle="No stores yet"
        emptyDescription="National warehouses and district stores appear here once they are set up."
        rowActions={(store) => (
          <RowActions
            label={`Actions for ${store.name}`}
            actions={[
              {
                label: 'View users',
                icon: Users,
                onSelect: () => {
                  router.push(USERS_PATH);
                },
              },
              {
                label: 'Copy store code',
                icon: Copy,
                onSelect: () => {
                  void copyText(store.code, 'store code');
                },
              },
            ]}
          />
        )}
      />
    </div>
  );
}
