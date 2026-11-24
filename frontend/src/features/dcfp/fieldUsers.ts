import { z } from 'zod';

import { newUserSchema } from '@/features/users/userForm';
import { optionalText, parseBody, parseList, type HttpClient } from '@/lib/api';
import { ugandanMobile } from '@/lib/phone';

/*
 * The field users a DCFP looks after: the VHTs, hotspot managers and delivery
 * agents who work in the DCFP's own district.
 *
 *   GET  /users/district    { users: User[] }   users:district_read
 *   POST /users/district    { user_id }         users:district_create
 *
 * The server works out the district from the caller (their district store or
 * subcounty) and answers 403 when they have none. A new account can only take
 * one of the three field roles: a VHT needs a subcounty in the district, a
 * hotspot manager an active hotspot in it, and a delivery agent gets the
 * DCFP's district store from the server. Validation failures come back as
 * `{ message, error: { <body field>: <message> } }` (`lib/api/errors.ts`
 * reads that map), so the form's field names are the body's.
 */

/** The roles a DCFP may give, by their server names, in the order offered. */
export const FIELD_ROLES = ['vht', 'hotspot manager', 'delivery agent'] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

const idText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1));

const fieldUserSchema = z.object({
  id: idText,
  username: optionalText,
  firstname: optionalText,
  lastname: optionalText,
  email: optionalText,
  phone_number: optionalText,
  status: optionalText,
  roles: z
    .array(z.object({ id: idText, name: optionalText }))
    .nullish()
    .transform((roles) => roles ?? []),
  hot_spot: z
    .object({ id: idText, name: optionalText, village: optionalText })
    .nullish()
    .transform((value) => value ?? null),
  subcounty: z
    .object({ id: idText, name: optionalText, district_name: optionalText })
    .nullish()
    .transform((value) => value ?? null),
  store: z
    .object({ id: idText, name: optionalText, district_name: optionalText })
    .nullish()
    .transform((value) => value ?? null),
});

export type FieldUser = z.output<typeof fieldUserSchema>;

export async function listFieldUsers(http: HttpClient, signal?: AbortSignal): Promise<FieldUser[]> {
  const body = await http.get('/users/district', { signal });
  // `{ users }`, with `users` null when the district has none yet.
  const users =
    typeof body === 'object' && body !== null && 'users' in body ? (body.users ?? []) : body;
  return parseList(fieldUserSchema, users, 'district users');
}

/** `POST /users/district`. Only the place the role needs is sent. */
export interface NewFieldUserInput {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  role: FieldRole;
  subcounty_id?: string;
  hot_spot_id?: string;
}

export async function createFieldUser(http: HttpClient, input: NewFieldUserInput): Promise<string> {
  const body = await http.post('/users/district', input);
  return parseBody(z.object({ user_id: idText }), body, 'new district user').user_id;
}

/** Where an account works, in a few words: its hotspot, else its subcounty, else its store. */
export function assignmentOf(user: Pick<FieldUser, 'hot_spot' | 'subcounty' | 'store'>): {
  kind: 'Hotspot' | 'Subcounty' | 'Store';
  name: string;
} | null {
  if (user.hot_spot) return { kind: 'Hotspot', name: user.hot_spot.name ?? 'Unnamed hotspot' };
  if (user.subcounty)
    return { kind: 'Subcounty', name: user.subcounty.name ?? 'Unnamed subcounty' };
  if (user.store) return { kind: 'Store', name: user.store.name ?? 'District store' };
  return null;
}

/*
 * The form reuses the admin form's rules for names, username, email and
 * password (`features/users/userForm.ts`), under the body's field names. The
 * phone number is required here: a field user is reached by phone.
 */
const { firstname, lastname, username, email, password } = newUserSchema.shape;

export const fieldUserFormSchema = z
  .object({
    first_name: firstname,
    last_name: lastname,
    username,
    email,
    phone_number: ugandanMobile(),
    password,
    role: z.union([z.enum(FIELD_ROLES), z.literal('')]),
    subcounty_id: z.string(),
    hot_spot_id: z.string(),
  })
  .superRefine((values, context) => {
    if (values.role === '') {
      context.addIssue({ code: 'custom', path: ['role'], message: 'Choose a role.' });
    }
    if (values.role === 'vht' && values.subcounty_id === '') {
      context.addIssue({
        code: 'custom',
        path: ['subcounty_id'],
        message: 'Choose the subcounty they work in.',
      });
    }
    if (values.role === 'hotspot manager' && values.hot_spot_id === '') {
      context.addIssue({
        code: 'custom',
        path: ['hot_spot_id'],
        message: 'Choose the hotspot they run.',
      });
    }
  });

export type FieldUserFormInput = z.input<typeof fieldUserFormSchema>;
export type FieldUserFormOutput = z.output<typeof fieldUserFormSchema>;

export const FIELD_USER_DEFAULTS: FieldUserFormInput = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  phone_number: '',
  password: '',
  role: '',
  subcounty_id: '',
  hot_spot_id: '',
};

/** Every form field; the server's 422 keys are the same names. */
export const FIELD_USER_FIELDS = [
  'first_name',
  'last_name',
  'username',
  'email',
  'phone_number',
  'password',
  'role',
  'subcounty_id',
  'hot_spot_id',
] as const satisfies readonly (keyof FieldUserFormInput)[];

/** The request body: the email lower-cased, the phone in `+256` form, and only the place the role needs. */
export function toNewFieldUserInput(values: FieldUserFormOutput): NewFieldUserInput {
  if (values.role === '') throw new Error('A role is required.');
  return {
    username: values.username,
    email: values.email.toLowerCase(),
    password: values.password,
    first_name: values.first_name,
    last_name: values.last_name,
    phone_number: values.phone_number,
    role: values.role,
    ...(values.role === 'vht' ? { subcounty_id: values.subcounty_id } : {}),
    ...(values.role === 'hotspot manager' ? { hot_spot_id: values.hot_spot_id } : {}),
  };
}
