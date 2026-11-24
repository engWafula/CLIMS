import { Filter, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { SelectField } from '@/components/form/SelectField';
import { TextField } from '@/components/form/TextField';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  describeFilter,
  emptyRule,
  filterError,
  type ColumnFilter,
  type FilterKind,
  type FilterRule,
} from '@/lib/table/columnFilters';
import { filterRows } from '@/lib/table/tableModel';

export interface FilterColumn {
  id: string;
  header: string;
  kind: FilterKind;
  options?: readonly string[];
}

interface Props {
  label: string;
  columns: readonly FilterColumn[];
  filters: readonly ColumnFilter[];
  onChange: (filters: ColumnFilter[]) => void;
}

/** One filter editor, reused by every list. Filters only apply when the draft is valid. */
export function TableFilters({ label, columns, filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const activeColumn = columns.find((column) => column.id === editing) ?? columns[0];
  if (!activeColumn) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={`Filters${filters.length ? ` ${filters.length}` : ''} for ${label.toLowerCase()}`}
        >
          <Filter aria-hidden="true" />
          {/* The space keeps the visible text "Filters 2" inside the accessible name. */}
          Filters{' '}
          {filters.length ? (
            <span className="bg-secondary rounded px-1.5 text-xs tabular-nums">
              {filters.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain"
        aria-label={`Filter ${label.toLowerCase()}`}
      >
        <FilterEditor
          key={`${activeColumn.id}-${String(open)}`}
          column={activeColumn}
          columns={columns}
          existing={filters.find((filter) => filter.columnId === activeColumn.id)?.rule}
          onColumn={setEditing}
          onApply={(rule) => {
            onChange([
              ...filters.filter((filter) => filter.columnId !== activeColumn.id),
              { columnId: activeColumn.id, rule },
            ]);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Active constraints remain visible even when their columns are hidden. */
export function ActiveTableFilters({ columns, filters, onChange }: Omit<Props, 'label'>) {
  return (
    <>
      {filters.map((filter) => (
        <Button
          key={filter.columnId}
          data-print-text
          type="button"
          variant="secondary"
          size="sm"
          className="max-w-full"
          aria-label={`${columns.find((column) => column.id === filter.columnId)?.header ?? filter.columnId}: ${describeFilter(filter.rule)}. Remove filter`}
          onClick={() => {
            onChange(filters.filter((item) => item.columnId !== filter.columnId));
          }}
        >
          <span className="truncate">
            {columns.find((column) => column.id === filter.columnId)?.header}:{' '}
            {describeFilter(filter.rule)}
          </span>
          <X aria-hidden="true" />
        </Button>
      ))}
    </>
  );
}

function FilterEditor({
  column,
  columns,
  existing,
  onColumn,
  onApply,
}: {
  column: FilterColumn;
  columns: readonly FilterColumn[];
  existing?: FilterRule;
  onColumn: (id: string) => void;
  onApply: (rule: FilterRule) => void;
}) {
  const [rule, setRule] = useState<FilterRule>(() => existing ?? emptyRule(column.kind));
  const [tried, setTried] = useState(false);
  const [query, setQuery] = useState('');
  const errorId = useId();
  const error = tried ? filterError(rule) : null;
  const options = useMemo(
    () => filterRows(column.options ?? [], query, (value) => [value]),
    [column.options, query],
  );
  const operators = [
    ...(column.kind === 'text'
      ? [
          { value: 'contains', label: 'Contains' },
          { value: 'equals', label: 'Equals' },
          { value: 'not_contains', label: 'Does not contain' },
        ]
      : column.kind === 'select'
        ? [{ value: 'one_of', label: 'Is any of' }]
        : [{ value: column.kind === 'number' ? 'number_range' : 'date_range', label: 'Between' }]),
    { value: 'empty', label: 'Is empty' },
    { value: 'not_empty', label: 'Is not empty' },
  ];
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!filterError(rule)) onApply(rule);
      }}
    >
      <div>
        <h3 className="text-sm font-semibold">Filter records</h3>
        <p className="text-muted-foreground text-xs">All column filters apply together.</p>
      </div>
      <SelectField
        label="Column"
        required
        value={column.id}
        options={columns.map((item) => ({ value: item.id, label: item.header }))}
        onValueChange={onColumn}
        placeholder="Choose a column"
      />
      <SelectField
        label="Condition"
        required
        value={rule.operator}
        options={operators}
        onValueChange={(operator) => {
          setTried(false);
          if (operator === 'empty' || operator === 'not_empty') setRule({ operator });
          else if (operator === 'contains' || operator === 'equals' || operator === 'not_contains')
            setRule({ operator, value: 'value' in rule ? rule.value : '' });
          else setRule(emptyRule(column.kind));
        }}
        placeholder="Choose a condition"
      />
      {'value' in rule ? (
        <TextField
          label="Filter value"
          required
          value={rule.value}
          maxLength={250}
          onChange={(event) => {
            setRule({ ...rule, value: event.target.value });
          }}
          error={error ?? undefined}
        />
      ) : null}
      {'from' in rule ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={column.kind === 'date' ? 'From date' : 'Minimum'}
            type={column.kind === 'date' ? 'date' : 'text'}
            inputMode={column.kind === 'number' ? 'decimal' : undefined}
            maxLength={40}
            value={rule.from}
            onChange={(event) => {
              setRule({ ...rule, from: event.target.value });
            }}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
          <TextField
            label={column.kind === 'date' ? 'To date' : 'Maximum'}
            type={column.kind === 'date' ? 'date' : 'text'}
            inputMode={column.kind === 'number' ? 'decimal' : undefined}
            maxLength={40}
            value={rule.to}
            onChange={(event) => {
              setRule({ ...rule, to: event.target.value });
            }}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>
      ) : null}
      {rule.operator === 'one_of' ? (
        <fieldset aria-describedby={error ? errorId : undefined} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Values</legend>
          <TextField
            label="Search filter values"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <div className="max-h-44 overflow-y-auto rounded-md border p-1">
            {options.slice(0, 100).map((option) => (
              <label
                key={option}
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm"
              >
                <Checkbox
                  checked={rule.values.includes(option)}
                  onChange={() => {
                    setRule({
                      ...rule,
                      values: rule.values.includes(option)
                        ? rule.values.filter((item) => item !== option)
                        : [...rule.values, option],
                    });
                  }}
                />
                <span className="break-words">{option}</span>
              </label>
            ))}
            {!options.length ? (
              <p className="text-muted-foreground p-2 text-sm">No values match.</p>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {rule.values.length} selected
            {options.length > 100
              ? ' · Showing the first 100 matches. Search to narrow the list.'
              : ''}
          </p>
        </fieldset>
      ) : null}
      {error && !('value' in rule) ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full">
        Apply filter
      </Button>
    </form>
  );
}
