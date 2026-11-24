'use client';

import { CalendarRange, ListFilter, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { ComboboxField } from '@/components/form/ComboboxField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useRegions, useStores } from '@/features/geography/queries';
import { cn } from '@/lib/utils';

import {
  EMPTY_FILTERS,
  INTERVAL_LABELS,
  INTERVALS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  periodLabel,
  type FilterField,
  type ReportFilterState,
} from './filters';
import type { ReportFilters } from './useReportFilters';

const ALL = '__all';

const CATEGORY_OPTIONS = [
  { value: ALL, label: 'Male and female' },
  { value: 'male', label: 'Male condoms' },
  { value: 'female', label: 'Female condoms' },
];
const STORE_TYPE_OPTIONS = [
  { value: ALL, label: 'Every store' },
  { value: 'national', label: 'National warehouses' },
  { value: 'district', label: 'District stores' },
];
export const STATUS_OPTIONS = [
  { value: ALL, label: 'Every status' },
  { value: 'awaiting_supply', label: 'Awaiting supply' },
  { value: 'awaiting_acknowledgement', label: 'Awaiting acknowledgement' },
  { value: 'partly_received', label: 'Partly received' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
];
export const BAND_OPTIONS = [
  { value: ALL, label: 'Every expiry band' },
  { value: 'expired', label: 'Expired' },
  { value: 'under_1_month', label: 'Under 1 month' },
  { value: 'under_3_months', label: '1 to 3 months' },
  { value: 'under_6_months', label: '3 to 6 months' },
  { value: 'ok', label: '6 months or more' },
  { value: 'unknown', label: 'No expiry date' },
];

interface FilterBarProps {
  filters: ReportFilters;
  /** Every filter this page's reports read; the pane offers them all. */
  fields: readonly FilterField[];
  /** The ones shown in the bar itself; the rest are under "All filters". */
  inline?: readonly FilterField[];
  className?: string;
}

/**
 * The slicers above a dashboard or report, as in Power BI and Superset: one row
 * scoping every visual under it, an "All filters" pane with every slicer, and
 * the active filters as removable chips. Filters live in the address.
 */
export function FilterBar({
  filters,
  fields,
  inline = ['period', 'district', 'category'],
  className,
}: FilterBarProps) {
  const [paneOpen, setPaneOpen] = useState(false);
  const has = (field: FilterField) => fields.includes(field);
  const options = useFilterOptions(has('district') || has('warehouse'), has('region'));
  const chips = activeChips(filters.state, fields, options);
  const shownInline = inline.filter(has);

  return (
    <section
      aria-label="Report filters"
      className={cn('bg-card rounded-card flex flex-col gap-2 border px-4 py-3', className)}
      data-print-hide=""
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {shownInline.map((field) => (
          <FieldControl key={field} field={field} filters={filters} options={options} compact />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPaneOpen(true);
            }}
          >
            <ListFilter data-icon="inline-start" />
            All filters
            {chips.length > 0 ? (
              <span className="bg-primary text-primary-foreground ml-0.5 rounded-full px-1.5 text-[0.6875rem] leading-4 font-semibold tabular-nums">
                {chips.length}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {has('period') ? (
          <p
            className="text-muted-foreground mr-1 flex items-center gap-1.5 text-xs"
            data-filter-period={`${periodLabel(filters.period)}${has('interval') ? ` (${INTERVAL_LABELS[filters.interval].toLowerCase()})` : ''}`}
          >
            <CalendarRange className="size-3.5" aria-hidden="true" />
            <span>
              {periodLabel(filters.period)}
              {has('interval') ? ` · ${INTERVAL_LABELS[filters.interval].toLowerCase()}` : ''}
            </span>
          </p>
        ) : null}
        {chips.map((chip) => (
          <span
            key={chip.key}
            data-filter-chip={chip.label}
            data-filter-value={chip.value}
            className="bg-secondary text-foreground inline-flex h-6 items-center gap-1 rounded-full pl-2.5 text-xs"
          >
            <span className="text-muted-foreground">{chip.label}:</span>
            <span className="max-w-48 truncate font-medium">{chip.value}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="hover:bg-background size-6 rounded-full"
              aria-label={`Remove filter ${chip.label}: ${chip.value}`}
              onClick={() => {
                filters.update(chip.clear);
              }}
            >
              <X className="size-3" aria-hidden="true" />
            </Button>
          </span>
        ))}
        {chips.length > 0 ? (
          <Button
            variant="link"
            size="xs"
            className="h-6 px-1 text-xs"
            onClick={() => {
              filters.reset();
            }}
          >
            Clear all
          </Button>
        ) : null}
      </div>

      <Sheet open={paneOpen} onOpenChange={setPaneOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Every chart, figure, table and download on this page follows these filters.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {fields.map((field) => (
              <FieldControl key={field} field={field} filters={filters} options={options} />
            ))}
          </div>
          <SheetFooter className="flex-row justify-between border-t">
            <Button
              variant="ghost"
              onClick={() => {
                filters.reset();
              }}
            >
              Clear all
            </Button>
            <Button
              onClick={() => {
                setPaneOpen(false);
              }}
            >
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface FilterOptions {
  districts: Option[];
  warehouses: Option[];
  regions: Option[];
  isLoading: boolean;
  error: string | undefined;
}

/** Districts are those with a district store, which every supply report groups by. */
function useFilterOptions(needStores: boolean, needRegions: boolean): FilterOptions {
  const stores = useStores(needStores);
  const regions = useRegions(needRegions);
  return useMemo(() => {
    const list = stores.data ?? [];
    const seen = new Set<string>();
    const districts: Option[] = [];
    for (const store of list) {
      if (store.store_type !== 'district' || !store.district_id || seen.has(store.district_id))
        continue;
      seen.add(store.district_id);
      districts.push({ value: store.district_id, label: store.district_name ?? store.name });
    }
    districts.sort((a, b) => a.label.localeCompare(b.label));
    return {
      districts,
      warehouses: list
        .filter((store) => store.store_type === 'national')
        .map((store) => ({ value: store.id, label: store.name })),
      regions: (regions.data ?? []).map((region) => ({ value: region.id, label: region.name })),
      isLoading: stores.isPending && needStores,
      error: stores.isError ? 'The districts could not be loaded.' : undefined,
    };
  }, [stores.data, stores.isPending, stores.isError, regions.data, needStores]);
}

interface Chip {
  key: string;
  label: string;
  value: string;
  clear: Partial<ReportFilterState>;
}

function labelOf(options: readonly Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** The filters set away from their defaults, in words. */
export function activeChips(
  state: ReportFilterState,
  fields: readonly FilterField[],
  options: Pick<FilterOptions, 'districts' | 'warehouses' | 'regions'>,
): Chip[] {
  const chips: Chip[] = [];
  const has = (field: FilterField) => fields.includes(field);
  if (has('period') && state.preset !== EMPTY_FILTERS.preset) {
    chips.push({
      key: 'period',
      label: 'Period',
      value:
        state.preset === 'custom'
          ? [state.from || '…', state.to || 'today'].join(' to ')
          : PERIOD_LABELS[state.preset],
      clear: { preset: EMPTY_FILTERS.preset, from: '', to: '' },
    });
  }
  if (has('interval') && state.interval !== 'auto')
    chips.push({
      key: 'interval',
      label: 'Interval',
      value: INTERVAL_LABELS[state.interval],
      clear: { interval: 'auto' },
    });
  if (has('region') && state.regionId)
    chips.push({
      key: 'region',
      label: 'Region',
      value: labelOf(options.regions, state.regionId),
      clear: { regionId: '' },
    });
  if (has('district') && state.districtId)
    chips.push({
      key: 'district',
      label: 'District',
      value: labelOf(options.districts, state.districtId),
      clear: { districtId: '' },
    });
  if (has('warehouse') && state.warehouseId)
    chips.push({
      key: 'warehouse',
      label: 'Warehouse',
      value: labelOf(options.warehouses, state.warehouseId),
      clear: { warehouseId: '' },
    });
  if (has('storeType') && state.storeType)
    chips.push({
      key: 'storeType',
      label: 'Stores',
      value: labelOf(STORE_TYPE_OPTIONS, state.storeType),
      clear: { storeType: '' },
    });
  if (has('category') && state.category)
    chips.push({
      key: 'category',
      label: 'Type',
      value: labelOf(CATEGORY_OPTIONS, state.category),
      clear: { category: '' },
    });
  if (has('status') && state.status)
    chips.push({
      key: 'status',
      label: 'Status',
      value: labelOf(STATUS_OPTIONS, state.status),
      clear: { status: '' },
    });
  if (has('band') && state.band)
    chips.push({
      key: 'band',
      label: 'Expiry',
      value: labelOf(BAND_OPTIONS, state.band),
      clear: { band: '' },
    });
  if (has('month') && state.month)
    chips.push({ key: 'month', label: 'Month', value: state.month, clear: { month: '' } });
  return chips;
}

interface FieldControlProps {
  field: FilterField;
  filters: ReportFilters;
  options: FilterOptions;
  /** In the bar: narrower controls. */
  compact?: boolean;
}

function FieldControl({ field, filters, options, compact = false }: FieldControlProps) {
  const { state, update } = filters;
  const width = compact ? 'w-44' : 'w-full';
  switch (field) {
    case 'period':
      return (
        <div className={cn('flex flex-wrap items-end gap-2', !compact && 'flex-col items-stretch')}>
          <StackedSelect
            label="Period"
            value={state.preset}
            options={PERIOD_PRESETS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
            onChange={(value) => {
              update({ preset: value as ReportFilterState['preset'] });
            }}
            className={width}
          />
          {state.preset === 'custom' ? (
            <div className="flex items-end gap-2">
              <DateInput
                label="From"
                value={state.from}
                max={state.to || undefined}
                onChange={(from) => {
                  update({ from });
                }}
              />
              <DateInput
                label="To"
                value={state.to}
                min={state.from || undefined}
                onChange={(to) => {
                  update({ to });
                }}
              />
            </div>
          ) : null}
        </div>
      );
    case 'interval':
      return (
        <StackedSelect
          label="Interval"
          value={state.interval}
          options={INTERVALS.map((value) => ({ value, label: INTERVAL_LABELS[value] }))}
          onChange={(value) => {
            update({ interval: value as ReportFilterState['interval'] });
          }}
          className={compact ? 'w-32' : width}
        />
      );
    case 'district':
      return (
        <ComboboxField
          label="District"
          required
          value={state.districtId || ALL}
          onValueChange={(value) => {
            update({ districtId: value === ALL ? '' : value });
          }}
          options={[{ value: ALL, label: 'Every district' }, ...options.districts]}
          placeholder="Every district"
          searchLabel="Search districts"
          noun="district"
          isLoading={options.isLoading}
          loadError={options.error}
          className={cn(
            compact ? 'w-56' : 'w-full',
            '[&_label]:text-muted-foreground [&_label]:text-xs [&_label]:font-normal',
          )}
        />
      );
    case 'region':
      return (
        <StackedSelect
          label="Region"
          value={state.regionId || ALL}
          options={[{ value: ALL, label: 'Every region' }, ...options.regions]}
          onChange={(value) => {
            update({ regionId: value === ALL ? '' : value });
          }}
          className={width}
        />
      );
    case 'warehouse':
      return (
        <StackedSelect
          label="Warehouse"
          value={state.warehouseId || ALL}
          options={[{ value: ALL, label: 'NMS and JMS' }, ...options.warehouses]}
          onChange={(value) => {
            update({ warehouseId: value === ALL ? '' : value });
          }}
          className={width}
        />
      );
    case 'storeType':
      return (
        <StackedSelect
          label="Stores"
          value={state.storeType || ALL}
          options={STORE_TYPE_OPTIONS}
          onChange={(value) => {
            update({ storeType: value === ALL ? '' : (value as ReportFilterState['storeType']) });
          }}
          className={width}
        />
      );
    case 'category':
      return (
        <StackedSelect
          label="Condom type"
          value={state.category || ALL}
          options={CATEGORY_OPTIONS}
          onChange={(value) => {
            update({ category: value === ALL ? '' : (value as ReportFilterState['category']) });
          }}
          className={compact ? 'w-40' : width}
        />
      );
    case 'status':
      return (
        <StackedSelect
          label="Status"
          value={state.status || ALL}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            update({ status: value === ALL ? '' : value });
          }}
          className={width}
        />
      );
    case 'band':
      return (
        <StackedSelect
          label="Expiry"
          value={state.band || ALL}
          options={BAND_OPTIONS}
          onChange={(value) => {
            update({ band: value === ALL ? '' : value });
          }}
          className={width}
        />
      );
    case 'month':
      return (
        <MonthInput
          value={state.month}
          onChange={(month) => {
            update({ month });
          }}
        />
      );
  }
}

function StackedSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        className="h-8 w-38"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function MonthInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        Month
      </Label>
      <Input
        id={id}
        type="month"
        className="h-8 w-40"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
