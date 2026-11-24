import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type Ref } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second, quieter line, e.g. where it is. Searched along with the label. */
  hint?: string;
}

interface ComboboxFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  options: readonly ComboboxOption[];
  placeholder: string;
  /** Names what can be typed, e.g. "Search by name or village". */
  searchLabel: string;
  /** The options in a count or a miss, plural and lower case, e.g. "hotspots". */
  noun: string;
  error?: string;
  description?: string;
  required?: boolean;
  /** True while the options are being fetched. */
  isLoading?: boolean;
  /** Set when the options could not be fetched. */
  loadError?: string;
  disabled?: boolean;
  /** Lets a form focus this field, e.g. when it is the first one in error. */
  triggerRef?: Ref<HTMLButtonElement>;
  className?: string;
}

/** Rendering thousands of rows is slow and nobody scrolls them; typing narrows instead. */
const MAX_SHOWN = 100;
/** How far Page Up and Page Down move. */
const PAGE_STEP = 10;

function matchesAll(option: ComboboxOption, terms: readonly string[]): boolean {
  const text = `${option.label} ${option.hint ?? ''}`.toLowerCase();
  return terms.every((term) => text.includes(term));
}

/**
 * A labelled choice from more options than a select can hold: the field opens
 * a list with a search box, and every word typed must appear in an option's
 * label or hint. Looks like `SelectField` until opened.
 */
export function ComboboxField({
  label,
  value,
  onValueChange,
  onBlur,
  options,
  placeholder,
  searchLabel,
  noun,
  error,
  description,
  required,
  isLoading = false,
  loadError,
  disabled = false,
  triggerRef,
  className,
}: ComboboxFieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error || loadError ? `${id}-error` : undefined;
  const message = error ?? loadError;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);
  const found = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length > 0 ? options.filter((option) => matchesAll(option, terms)) : options;
  }, [options, query]);
  const shown = found.slice(0, MAX_SHOWN);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // `optionId` is derived from `id`, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) return;
    setQuery('');
    // Open on the current choice when it is among the rows drawn.
    const index = options.slice(0, MAX_SHOWN).findIndex((option) => option.value === value);
    setActive(Math.max(0, index));
  }

  function choose(option: ComboboxOption) {
    onValueChange(option.value);
    setOpen(false);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = shown.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      PageDown: Math.min(active + PAGE_STEP, last),
      PageUp: Math.max(active - PAGE_STEP, 0),
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(Math.max(0, moves[event.key] ?? 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = shown[active];
      if (option) choose(option);
    }
  }

  const triggerText = selected?.label ?? placeholder;

  return (
    <Field data-invalid={message ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? null : <span className="text-muted-foreground font-normal">(optional)</span>}
      </FieldLabel>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            ref={triggerRef}
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-busy={isLoading}
            aria-controls={open ? listId : undefined}
            aria-required={required}
            aria-invalid={message ? true : undefined}
            aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
            data-placeholder={selected ? undefined : ''}
            disabled={disabled || isLoading || options.length === 0}
            onBlur={onBlur}
            className="border-input bg-card data-placeholder:text-muted-foreground w-full justify-between pr-2 text-left font-normal"
          >
            {isLoading ? (
              <>
                <span role="status" className="sr-only">
                  Loading {noun}…
                </span>
                <Skeleton aria-hidden="true" className="h-3.5 w-2/5 max-w-32" />
              </>
            ) : (
              <span className="min-w-0 truncate">{triggerText}</span>
            )}
            <ChevronDownIcon
              className="text-muted-foreground pointer-events-none size-4 shrink-0"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={label}
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        >
          <div className="flex items-center gap-2 border-b px-2.5">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <Input
              type="text"
              role="combobox"
              aria-label={searchLabel}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={shown[active] ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={`${searchLabel}…`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className={cn('max-h-64 overflow-y-auto p-1', shown.length === 0 && 'hidden')}
          >
            {shown.map((option, index) => {
              const current = option.value === value;
              return (
                // Keys are handled by the search box, which points at this row with aria-activedescendant.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active ? '' : undefined}
                  className="data-active:bg-accent relative flex cursor-default flex-col gap-0.5 rounded-md py-1.5 pr-8 pl-2 text-sm select-none"
                  onMouseMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  // Keeps focus, and the active row, in the search box.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    choose(option);
                  }}
                >
                  <span className="wrap-anywhere">{option.label}</span>
                  {option.hint ? (
                    <span className="text-muted-foreground text-xs wrap-anywhere">
                      {option.hint}
                    </span>
                  ) : null}
                  {current ? (
                    <>
                      <CheckIcon className="absolute top-2 right-2 size-4" aria-hidden="true" />
                      <span className="sr-only">(chosen)</span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p
            role="status"
            className={cn(
              'text-muted-foreground px-3 text-xs',
              found.length === 0 ? 'py-6 text-center text-sm' : 'border-t py-2',
              found.length > 0 && found.length <= MAX_SHOWN && 'sr-only',
            )}
          >
            {found.length === 0
              ? `No ${noun} match “${query.trim()}”.`
              : found.length > MAX_SHOWN
                ? `Showing ${formatNumber(MAX_SHOWN)} of ${formatNumber(found.length)} ${noun}. Type to narrow the list.`
                : `${formatNumber(found.length)} ${noun}.`}
          </p>
        </PopoverContent>
      </Popover>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {message ? <FieldError id={errorId}>{message}</FieldError> : null}
    </Field>
  );
}
