'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, CircleCheck, Eye, EyeOff, Smartphone } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Brand } from '@/components/layout/Brand';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getErrorMessage } from '@/lib/api';
import { ACTIVATED_PARAM, SSO_ERROR_PARAM } from '@/navigation/paths';

import { FieldAppOnlyError, useSignIn } from './hooks';

const credentialsSchema = z.object({
  // An email address, username or phone number; the API works out which.
  login: z.string().trim().min(1, 'Enter your email, username or phone number.').max(255),
  // Not trimmed: a password may legitimately begin or end with a space.
  password: z.string().min(1, 'Enter your password.').max(200),
});

type CredentialsForm = z.infer<typeof credentialsSchema>;

/** `?activated=1`: the visitor has just activated an invitation (see the onboarding feature). */
const activatedParamSchema = z.literal('1');

/** Why portal sign-in sent the visitor here instead (`?sso_error=`), as the API and the handoff page report it. */
const PORTAL_ERRORS = new Map(
  Object.entries({
    denied:
      'Your portal account does not have access to CLIMS. Ask your administrator to grant it.',
    unavailable:
      'Your portal account is not linked to an active CLIMS account. Ask your administrator to link it.',
    expired: 'Portal sign-in took too long or was already used. Open CLIMS from the portal again.',
    invalid: 'Portal sign-in could not be verified. Open CLIMS from the portal again.',
    failed: 'Portal sign-in is not available right now. Try again shortly or sign in below.',
  }),
);

/** `?sso_error=mobile`: portal sign-in reached a field account, which has no web access. */
const PORTAL_FIELD_ACCOUNT = 'mobile';

/** Shown in place of the failure alert to a VHT, hotspot manager or delivery agent. */
function FieldAppOnlyAlert() {
  return (
    <Alert variant="info">
      <Smartphone aria-hidden="true" />
      <AlertTitle>Use the CLIMS mobile app</AlertTitle>
      <AlertDescription>
        VHTs, hotspot managers and delivery agents work in the mobile app, not on the web. Sign in
        on your phone with this same account.
      </AlertDescription>
    </Alert>
  );
}

/** The sign-in screen. On success the guard around it moves the user on. */
export default function SignInPage() {
  const signIn = useSignIn();
  const searchParams = useSearchParams();
  const isJustActivated = activatedParamSchema.safeParse(searchParams.get(ACTIVATED_PARAM)).success;
  const portalErrorCode = searchParams.get(SSO_ERROR_PARAM) ?? '';
  const portalError = PORTAL_ERRORS.get(portalErrorCode) ?? null;
  const fieldAccount =
    signIn.error instanceof FieldAppOnlyError ||
    (!signIn.isError && portalErrorCode === PORTAL_FIELD_ACCOUNT);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CredentialsForm>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { login: '', password: '' },
  });

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Brand />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-muted-foreground text-sm">Last-mile condom distribution</p>
          </div>
        </div>

        <div className="bg-card rounded-card border p-5 sm:p-6">
          <form
            noValidate
            onSubmit={handleSubmit((credentials) => {
              signIn.mutate(credentials);
            })}
          >
            <FieldGroup>
              {isJustActivated && !signIn.isError ? (
                <Alert variant="success">
                  <CircleCheck aria-hidden="true" />
                  <AlertTitle>Your account is active</AlertTitle>
                  <AlertDescription>
                    Sign in with your email address and the password you just created.
                  </AlertDescription>
                </Alert>
              ) : null}
              {portalError && !signIn.isError ? (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Could not sign in from the portal</AlertTitle>
                  <AlertDescription>{portalError}</AlertDescription>
                </Alert>
              ) : null}
              {fieldAccount ? (
                <FieldAppOnlyAlert />
              ) : signIn.isError ? (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Could not sign in</AlertTitle>
                  <AlertDescription>{getErrorMessage(signIn.error)}</AlertDescription>
                </Alert>
              ) : null}

              <Field data-invalid={errors.login ? true : undefined}>
                <FieldLabel htmlFor="login">Email, username or phone</FieldLabel>
                <Input
                  id="login"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={errors.login ? true : undefined}
                  aria-describedby={errors.login ? 'login-error' : undefined}
                  {...register('login')}
                />
                <FieldError id="login-error" errors={[errors.login]} />
              </Field>

              <Field data-invalid={errors.password ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    type={isPasswordVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="pr-10"
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    {...register('password')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground absolute top-1/2 right-1 -translate-y-1/2"
                    aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={isPasswordVisible}
                    onClick={() => {
                      setIsPasswordVisible((visible) => !visible);
                    }}
                  >
                    {isPasswordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </div>
                <FieldError id="password-error" errors={[errors.password]} />
              </Field>

              <Button type="submit" disabled={signIn.isPending} className="w-full">
                {signIn.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                {signIn.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </FieldGroup>
          </form>
        </div>

        <p className="text-muted-foreground text-center text-sm text-pretty">
          Forgotten your password? An administrator can set a new one for you in User management.
        </p>
      </div>
    </main>
  );
}
