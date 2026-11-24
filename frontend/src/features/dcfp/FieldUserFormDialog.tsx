import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { ComboboxField } from '@/components/form/ComboboxField';
import { FormDialog } from '@/components/form/FormDialog';
import { formLevelError } from '@/components/form/serverErrors';
import { SelectField } from '@/components/form/SelectField';
import { TextField } from '@/components/form/TextField';
import { useCurrentUser } from '@/features/auth/hooks';
import { useDistrictHotspots, useStores, useSubcounties } from '@/features/geography/queries';
import type { Role } from '@/features/users/api';
import { RolePicker } from '@/features/users/RolePicker';
import { getErrorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';

import {
  FIELD_ROLES,
  FIELD_USER_DEFAULTS,
  FIELD_USER_FIELDS,
  fieldUserFormSchema,
  toNewFieldUserInput,
  type FieldUserFormInput,
  type FieldUserFormOutput,
} from './fieldUsers';
import { useCreateFieldUser } from './queries';

/** The three field roles, in the shape the shared role picker takes; the id is the server name. */
const ROLE_CHOICES: readonly Role[] = FIELD_ROLES.map((name) => ({
  id: name,
  name,
  permissions: [],
}));

const lookupError = (error: unknown, what: string) =>
  error ? `Could not load ${what}. ${getErrorMessage(error)}` : undefined;

/**
 * The DCFP's district: the one their district store is in. The subcounty and
 * hotspot lists are that district's; the server checks the choice again.
 */
function useOwnDistrict() {
  const storeId = useCurrentUser()?.store_id ?? null;
  const stores = useStores(storeId !== null);
  const store = stores.data?.find((item) => item.id === storeId);
  return {
    districtId: store?.district_id ?? '',
    isPending: storeId !== null && stores.isPending,
    error: stores.error,
    missing: storeId === null || (stores.isSuccess && !store?.district_id),
  };
}

/**
 * Creates a VHT, hotspot manager or delivery agent in the DCFP's district
 * (`POST /users/district`). Mount it to open; `onClose` unmounts it.
 */
export function FieldUserFormDialog({ onClose }: { onClose: () => void }) {
  const createUser = useCreateFieldUser();
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FieldUserFormInput, unknown, FieldUserFormOutput>({
    resolver: zodResolver(fieldUserFormSchema),
    defaultValues: FIELD_USER_DEFAULTS,
  });
  const role = useWatch({ control, name: 'role' });
  const district = useOwnDistrict();
  const subcounties = useSubcounties(role === 'vht' ? district.districtId : '');
  const hotspots = useDistrictHotspots(role === 'hotspot manager' ? district.districtId : '');
  const hotspotOptions = useMemo(
    () =>
      (hotspots.data ?? [])
        // Only an active hotspot can have a manager.
        .filter((hotspot) => hotspot.reviewStatus === 'active')
        .map((hotspot) => ({
          value: hotspot.id,
          label: hotspot.name || 'Unnamed hotspot',
          hint: [hotspot.village, hotspot.subcountyName].filter(Boolean).join(', ') || undefined,
        })),
    [hotspots.data],
  );
  const noHotspots = hotspots.isSuccess && hotspotOptions.length === 0;
  const districtProblem = district.missing
    ? 'Your account has no district store, so the places in your district cannot be listed.'
    : lookupError(district.error, 'your district');

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    createUser.mutate(toNewFieldUserInput(values), {
      onSuccess: onClose,
      onError: (error) => {
        setFormError(formLevelError(error, FIELD_USER_FIELDS, setError));
      },
    });
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="New field user"
      description="Create an account for a VHT, hotspot manager or delivery agent in your district. They sign in to the mobile app with this email address and password."
      submitLabel="Create user"
      pendingLabel="Creating…"
      isPending={createUser.isPending}
      isDirty={isDirty}
      error={formError}
      onSubmit={onSubmit}
    >
      <TextField
        label="First name"
        required
        autoComplete="off"
        error={errors.first_name?.message}
        {...register('first_name')}
      />
      <TextField
        label="Last name"
        required
        autoComplete="off"
        error={errors.last_name?.message}
        {...register('last_name')}
      />
      <TextField
        label="Username"
        required
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={errors.username?.message}
        {...register('username')}
      />
      <TextField
        label="Email"
        type="email"
        required
        autoComplete="off"
        spellCheck={false}
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        label="Phone number"
        type="tel"
        required
        autoComplete="off"
        placeholder="+256 7XX XXX XXX"
        error={errors.phone_number?.message}
        {...register('phone_number')}
      />
      <TextField
        label="Password"
        type="password"
        required
        autoComplete="new-password"
        description="At least 8 characters."
        error={errors.password?.message}
        {...register('password')}
      />
      <Controller
        control={control}
        name="role"
        render={({ field, fieldState }) => (
          <RolePicker
            roles={ROLE_CHOICES}
            isLoading={false}
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              // A place chosen for another role does not carry over.
              setValue('subcounty_id', '');
              setValue('hot_spot_id', '');
            }}
            onBlur={field.onBlur}
            inputRef={field.ref}
            error={fieldState.error?.message}
          />
        )}
      />
      {role === 'vht' ? (
        <Controller
          control={control}
          name="subcounty_id"
          render={({ field, fieldState }) => (
            <SelectField
              label="Subcounty"
              required
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              triggerRef={field.ref}
              placeholder="Choose a subcounty"
              description="A VHT works in one subcounty of your district."
              options={(subcounties.data ?? []).map((place) => ({
                value: place.id,
                label: place.name,
              }))}
              isLoading={
                district.isPending || (district.districtId !== '' && subcounties.isPending)
              }
              loadError={districtProblem ?? lookupError(subcounties.error, 'subcounties')}
              disabled={district.districtId === ''}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}
      {role === 'hotspot manager' ? (
        <Controller
          control={control}
          name="hot_spot_id"
          render={({ field, fieldState }) => (
            <ComboboxField
              className="sm:col-span-2"
              label="Hotspot"
              required
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              triggerRef={field.ref}
              options={hotspotOptions}
              placeholder={
                noHotspots ? 'No active hotspots in your district' : 'Find their hotspot'
              }
              searchLabel="Search by name or village"
              noun="hotspots"
              isLoading={district.isPending || (district.districtId !== '' && hotspots.isPending)}
              loadError={districtProblem ?? lookupError(hotspots.error, 'hotspots')}
              disabled={district.districtId === '' || noHotspots}
              description={
                noHotspots
                  ? 'Activate a hotspot first; only an active hotspot can have a manager.'
                  : hotspotOptions.length > 0
                    ? `${formatNumber(hotspotOptions.length)} active in your district.`
                    : undefined
              }
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}
      {role === 'delivery agent' ? (
        <p className="text-muted-foreground text-sm sm:col-span-2">
          A delivery agent works from your district store; it is assigned to the account
          automatically.
        </p>
      ) : null}
    </FormDialog>
  );
}
