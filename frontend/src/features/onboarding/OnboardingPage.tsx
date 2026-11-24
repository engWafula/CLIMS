'use client';

import { CalendarX2, CircleCheck, Link2Off, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Brand } from '@/components/layout/Brand';
import { SampleDataNotice } from '@/components/SampleData';
import { ErrorState } from '@/components/states/ErrorState';
import { StepTracker, type StepState } from '@/components/StepTracker';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStorage } from '@/lib/storage/StorageProvider';
import { formatUgandanMobile } from '@/lib/phone';
import { ACTIVATED_PARAM, SIGN_IN_PATH } from '@/navigation/paths';

import { inviteTokenSchema, type Invitation } from './api';
import { CodeStep } from './CodeStep';
import { DetailsStep } from './DetailsStep';
import { PasswordStep } from './PasswordStep';
import { PhoneStep } from './PhoneStep';
import {
  clearProgress,
  onboardingHref,
  reachableStep,
  readProgress,
  stepSchema,
  STEPS,
  writeProgress,
  type OnboardingProgress,
  type OnboardingStep,
} from './progress';
import { useInvitation } from './queries';

/*
 * Account activation: invitation → phone → SMS code → password → details,
 * then sign-in. The link is `/onboarding?invite=<token>`; the current step is
 * added as `&step=<step>` so a refresh or the Back button keeps it.
 *
 * The endpoints behind it are NOT YET IN THE GO API (see ./api.ts), so the
 * screen carries a sample-data notice.
 */

const STEP_LABELS: Record<OnboardingStep, string> = {
  phone: 'Phone',
  code: 'Code',
  password: 'Password',
  details: 'Details',
};

const SIGN_IN_AFTER_ACTIVATION = `${SIGN_IN_PATH}?${ACTIVATED_PARAM}=1`;

interface ShellProps {
  children: ReactNode;
}

/** The centred, signed-out page frame, as on sign-in. */
function Shell({ children }: ShellProps) {
  return (
    <main className="flex min-h-svh justify-center p-4 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-6 py-4">
        <Brand className="self-center" />
        {children}
      </div>
    </main>
  );
}

function Card({ children }: ShellProps) {
  return (
    <div className="bg-card rounded-card flex flex-col gap-5 border p-5 sm:p-6">{children}</div>
  );
}

interface InvitationProblemProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Offer the sign-in page as the way on (e.g. for an invitation already used). */
  showSignIn?: boolean;
}

/** Why this invitation cannot be activated, and what to do instead. */
function InvitationProblem({ icon: Icon, title, description, showSignIn }: InvitationProblemProps) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
        {showSignIn ? (
          <Button asChild className="mt-2">
            <Link href={SIGN_IN_PATH}>Go to sign in</Link>
          </Button>
        ) : (
          <Link href={SIGN_IN_PATH} className="text-sm font-medium underline underline-offset-4">
            Already activated? Sign in
          </Link>
        )}
      </div>
    </Card>
  );
}

/** The onboarding screen: validates the link, then looks the invitation up. */
export default function OnboardingPage() {
  const invite = inviteTokenSchema.safeParse(useSearchParams().get('invite'));

  return (
    <Shell>
      <SampleDataNotice subject="The invitations and SMS codes" />
      {invite.success ? (
        <InvitationFlow token={invite.data} />
      ) : (
        <InvitationProblem
          icon={Link2Off}
          title="This invitation link is not complete"
          description="Open the link from your invitation SMS again. If it still does not work, ask the person who invited you to send a new invitation."
        />
      )}
    </Shell>
  );
}

interface InvitationFlowProps {
  token: string;
}

function InvitationFlow({ token }: InvitationFlowProps) {
  const invitation = useInvitation(token);

  if (invitation.isPending) {
    return (
      <Card>
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading invitation…</span>
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-6 w-3/5" />
            <Skeleton className="h-4 w-4/5" />
            <div className="flex gap-2 py-2">
              {[0, 1, 2, 3].map((step) => (
                <Skeleton key={step} className="h-1.5 flex-1 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </Card>
    );
  }
  if (invitation.isError) {
    if (invitation.error.kind === 'not_found') {
      return (
        <InvitationProblem
          icon={Link2Off}
          title="We can't find this invitation"
          description="Check that you opened the whole link from your invitation SMS. If it still does not work, ask the person who invited you to send a new invitation."
        />
      );
    }
    return (
      <Card>
        <ErrorState
          title="Could not open your invitation"
          error={invitation.error}
          onRetry={() => void invitation.refetch()}
          isRetrying={invitation.isFetching}
        />
      </Card>
    );
  }

  const { data } = invitation;
  if (data.status === 'expired') {
    return (
      <InvitationProblem
        icon={CalendarX2}
        title="This invitation has expired"
        description={`Invitations are valid for a limited time. Ask ${data.invited_by} to send you a new one.`}
      />
    );
  }
  if (data.status === 'used') {
    return (
      <InvitationProblem
        icon={CircleCheck}
        title="This invitation has already been used"
        description="The account it created is active. Sign in with its email address and password. If that wasn't you, contact the person who invited you."
        showSignIn
      />
    );
  }
  return <OnboardingSteps token={token} invitation={data} />;
}

interface OnboardingStepsProps {
  token: string;
  invitation: Invitation;
}

function OnboardingSteps({ token, invitation }: OnboardingStepsProps) {
  const router = useRouter();
  const storage = useAppStorage();
  const requested = stepSchema.safeParse(useSearchParams().get('step'));
  const [progress, setProgress] = useState<OnboardingProgress | null>(() =>
    readProgress(storage, token),
  );
  // A step whose earlier steps are not done (e.g. a link to `step=details`) falls back to the first unfinished one.
  const step = reachableStep(requested.success ? requested.data : 'phone', progress);
  const position = STEPS.indexOf(step);

  // Keep the address naming the step on screen, without adding a history entry.
  useEffect(() => {
    if (!requested.success || requested.data !== step) router.replace(onboardingHref(token, step));
  }, [requested.success, requested.data, step, router, token]);

  // Move focus to the new step's heading, so keyboard and screen-reader users start there.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const saveProgress = (next: OnboardingProgress) => {
    writeProgress(storage, next);
    setProgress(next);
  };
  const goTo = (next: OnboardingStep) => {
    router.push(onboardingHref(token, next));
  };

  const trackerSteps = STEPS.map((id, index) => {
    const state: StepState =
      index < position ? 'done' : index === position ? 'current' : 'upcoming';
    return { id, label: STEP_LABELS[id], state };
  });

  const intro: Record<OnboardingStep, { title: string; text: ReactNode }> = {
    phone: {
      title: 'Activate your account',
      text: (
        <>
          {invitation.invited_by} added you to CLIMS as{' '}
          <strong className="text-foreground font-medium">{invitation.roles.join(' and ')}</strong>.
          Enter the phone number the invitation was sent to.
        </>
      ),
    },
    code: {
      title: 'Enter the code we sent',
      text: `A 6-digit code went by SMS to ${progress ? formatUgandanMobile(progress.phone) : 'your phone'}.`,
    },
    password: {
      title: 'Create a password',
      text: 'You will use your email address and this password to sign in.',
    },
    details: {
      title: 'Check your details',
      text: 'Your roles and working area were set by whoever invited you. Ask them if anything is wrong.',
    },
  };

  const stepProps = { token, onProgress: saveProgress, goTo };

  return (
    <Card>
      <StepTracker aria-label="Activation progress" steps={trackerSteps} />
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.06em] uppercase">
          Step {position + 1} of {STEPS.length}
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
          {intro[step].title}
        </h1>
        <p className="text-muted-foreground text-sm text-pretty">{intro[step].text}</p>
      </div>

      {/* `key` gives each step a fresh form, so a step revisited with Back starts clean. */}
      {step === 'phone' || !progress ? (
        <PhoneStep key="phone" {...stepProps} progress={progress} />
      ) : step === 'code' ? (
        <CodeStep key="code" {...stepProps} progress={progress} />
      ) : step === 'password' ? (
        <PasswordStep key="password" {...stepProps} progress={progress} />
      ) : (
        <DetailsStep
          key="details"
          {...stepProps}
          progress={progress}
          invitation={invitation}
          onActivated={() => {
            clearProgress(storage);
            router.replace(SIGN_IN_AFTER_ACTIVATION);
          }}
        />
      )}
    </Card>
  );
}
