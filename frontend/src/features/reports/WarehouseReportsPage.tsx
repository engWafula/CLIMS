'use client';

import { StoreSwitch } from '@/features/warehouse/StoreSwitch';
import { useWarehouseStore } from '@/features/warehouse/useWarehouseStore';
import { withStore } from '@/features/warehouse/paths';

import ReporterReportsPage from './ReporterReportsPage';
import { REPORT_PATHS } from './status';

/** The warehouse's monthly reports, for the store the workspace is showing (NMS or JMS). */
export default function WarehouseReportsPage() {
  const { store, href } = useWarehouseStore();
  return (
    <div className="gap-section flex flex-col">
      <StoreSwitch
        store={store}
        hrefFor={(code) => withStore(REPORT_PATHS.list('warehouse'), code)}
      />
      {/* Keyed by store so the month picked for one warehouse does not carry over to the other. */}
      <ReporterReportsPage
        key={store}
        workspace="warehouse"
        level="warehouse"
        store={store}
        linkTo={href}
      />
    </div>
  );
}
