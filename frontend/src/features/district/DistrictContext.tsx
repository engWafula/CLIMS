'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from 'react';

import { FilterSelect } from '@/components/FilterSelect';
import { useSession } from '@/features/auth/hooks';
import { readJson, writeJson } from '@/lib/storage/jsonStorage';
import { useAppStorage } from '@/lib/storage/StorageProvider';
import { useLocationDistricts } from '@/features/hotspots/queries';

const ALL = 'all';
const DistrictContext = createContext<{
  district: string | null;
  districtId: string | null;
} | null>(null);

/** The district menu when the page places it itself (the warehouse pages). */
const DistrictSelectContext = createContext<ReactElement | null>(null);

export function useDistrictContext() {
  return useContext(DistrictContext);
}

/**
 * The district menu, for a warehouse page to put in its toolbar row beside the
 * warehouse's name rather than on a row of its own. Renders nothing on a page
 * that has no district filter.
 */
export function DistrictSelect() {
  return useContext(DistrictSelectContext);
}

export function DistrictContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const isMoh = pathname === '/moh' || pathname.startsWith('/moh/');
  const isWarehouse = pathname === '/warehouse' || pathname.startsWith('/warehouse/');
  const isMap = pathname === '/moh/hotspot-map';
  /*
   * NMS and JMS serve the whole country, so the warehouse lists every district
   * rather than only those that have ordered from it: a district with no order yet
   * can still be picked, for instance to dispatch to it before it orders.
   */
  const locations = useLocationDistricts(isMoh || isWarehouse);
  const storage = useAppStorage();
  const session = useSession();
  const storageKey = `clims.district.${session?.user.id ?? 'anonymous'}`;
  const remembered = readJson(storage, storageKey, (value) =>
    typeof value === 'string' ? value : null,
  );
  const locationId = isMap ? params.get('district_id') : null;
  const fromUrl =
    params.get('district') ??
    (locationId ? locations.data?.find((location) => location.id === locationId)?.name : null);
  const selected = (fromUrl ?? remembered) || null;
  const locationsByName = new Map(
    (locations.data ?? []).map((location) => [location.name, location.id]),
  );
  const options = [...new Set(locationsByName.keys())]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const district = selected && options.includes(selected) ? selected : null;
  const districtId = district ? (locationsByName.get(district) ?? null) : null;

  useEffect(() => {
    if (fromUrl && (isMoh || isWarehouse)) writeJson(storage, storageKey, fromUrl);
  }, [fromUrl, isMoh, isWarehouse, storage, storageKey]);

  // The dashboards have their own report filters (period, district, type); lists and the map use this.
  const showSelector =
    /^(\/moh\/(?:hotspot-map|orders(?:\/warehouse)?|reports)|\/warehouse(?:\/requests)?)$/.test(
      pathname,
    );

  const selector = showSelector ? (
    <FilterSelect
      label="District"
      value={district ?? ALL}
      disabled={locations.isPending}
      options={[
        { value: ALL, label: 'All districts' },
        ...options.map((name) => ({ value: name, label: name })),
      ]}
      onValueChange={(value) => {
        writeJson(storage, storageKey, value);
        const next = new URLSearchParams(params.toString());
        next.delete('district_id');
        next.set('district', value);
        router.push(`${pathname}?${next}`);
      }}
    />
  ) : null;

  // The warehouse pages already open on a row naming the warehouse, so they put
  // the menu at its end with `DistrictSelect`; elsewhere it gets a row of its own.
  return (
    <DistrictContext.Provider value={isMoh || isWarehouse ? { district, districtId } : null}>
      <DistrictSelectContext.Provider value={isWarehouse ? selector : null}>
        {isWarehouse ? null : selector}
        {children}
      </DistrictSelectContext.Provider>
    </DistrictContext.Provider>
  );
}
