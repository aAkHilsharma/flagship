import { Brand } from './components/Brand';
import { useCallback, useEffect, useState } from 'react';
import { Flag, ArrowRight } from 'lucide-react';
import {
  ClerkProvider,
  CreateOrganization,
  OrganizationSwitcher,
  SignIn,
  SignUp,
  UserButton,
  useAuth,
} from '@clerk/react';
import { App } from './App';
import { ApiContext, createApi, type User } from './lib/api';

function OrganizationDashboard({ organizationId }: { organizationId: string }) {
  const { getToken } = useAuth();
  const token = useCallback(() => getToken({ organizationId }), [getToken, organizationId]);
  const [api] = useState(() => createApi(token));
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<User>('/me')
      .then((user) => {
        if (active) setUser(user);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api]);
  if (error)
    return (
      <div className="auth-gate">
        <h2>Unable to open organization</h2>
        <p role="alert">{error}</p>
        <OrganizationSwitcher hidePersonal />
        <button onClick={() => location.reload()}>Retry</button>
        <UserButton />
      </div>
    );
  if (!user) return <div className="boot">Loading organization…</div>;
  return (
    <ApiContext.Provider value={api}>
      <App user={user} />
    </ApiContext.Provider>
  );
}
function AuthGate() {
  const { isLoaded, isSignedIn, orgId, userId } = useAuth();
  const [signUp, setSignUp] = useState(location.pathname === '/sign-up');
  useEffect(() => {
    const update = () => setSignUp(location.pathname === '/sign-up');
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  if (!isLoaded) return <div className="boot">Loading sign in…</div>;
  if (!isSignedIn)
    return (
      <div className="login">
        <section className="login-story">
          <Brand />
          <h1>
            Ship the code.
            <br />
            <span>Choose the moment.</span>
          </h1>
          <p>
            Control who gets your next release.
            <br />
            Start small, roll out gradually, and revert when you need to.
          </p>
          <div className="rollout-preview" aria-label="Example rollout, 20 percent">
            <span className="preview-label">EXAMPLE ROLLOUT</span>
            <div className="preview-row">
              <span className="app-monogram">A</span>
              <div>
                <strong>Your application</strong>
                <small>Application</small>
              </div>
              <span className="preview-divider" />
              <span className="preview-flag">
                <Flag size={23} />
              </span>
              <div>
                <strong>One-step checkout</strong>
                <small>new-checkout</small>
              </div>
              <span className="preview-toggle" />
              <div className="preview-percent">
                <small>Rollout</small>
                <strong>20%</strong>
              </div>
            </div>
            <div className="preview-progress">
              <span />
            </div>
            <div className="preview-tags">
              <span>Employees</span>
              <span>Premium preview</span>
            </div>
          </div>
          <div className="auth-benefits">
            Feature flags <i /> Targeted rollouts <i /> Release control
          </div>
        </section>
        <section className="auth-panel" aria-label={signUp ? 'Create your account' : 'Sign in'}>
          <div className="auth-crosslink">
            {signUp ? 'Already have an account?' : 'New to Flagship?'}{' '}
            <a href={signUp ? '/' : '/sign-up'}>
              {signUp ? 'Sign in' : 'Sign up'} <ArrowRight size={16} />
            </a>
          </div>
          {signUp ? (
            <SignUp routing="hash" signInUrl="/" forceRedirectUrl="/" />
          ) : (
            <SignIn routing="hash" signUpUrl="/sign-up" forceRedirectUrl="/" />
          )}
        </section>
      </div>
    );
  if (!orgId)
    return (
      <div className="auth-gate">
        <h1>Your organization</h1>
        <p>Create your team’s organization or select one you already belong to.</p>
        <OrganizationSwitcher hidePersonal />
        <CreateOrganization routing="hash" afterCreateOrganizationUrl="/" skipInvitationScreen />
        <UserButton />
      </div>
    );
  return <OrganizationDashboard key={userId + ':' + orgId} organizationId={orgId} />;
}
export function Auth() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey)
    return (
      <div className="auth-gate">
        <h1>Configure Clerk</h1>
        <p>Add VITE_CLERK_PUBLISHABLE_KEY to the root .env file and restart the dashboard.</p>
      </div>
    );
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your Flagship account.' } },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Start managing your releases with Flagship.',
          },
        },
      }}
    >
      <AuthGate />
    </ClerkProvider>
  );
}
