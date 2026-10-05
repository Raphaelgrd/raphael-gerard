import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from './App';
import Brand from './components/Brand';
import Login from './components/Login';
import { authLinkError, authLinkType, cloudEnabled, fetchProfile, frError, signOut, supabase, type Profile } from './lib/cloud';

export default function Root() {
  return cloudEnabled ? <CloudRoot /> : <App cloud={null} />;
}

function CloudRoot() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needPassword, setNeedPassword] = useState(authLinkType === 'invite' || authLinkType === 'recovery');
  const [error, setError] = useState<string | null>(authLinkError ? 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.' : null);

  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase!.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setNeedPassword(true);
    });
    // Retire les jetons de l'URL une fois lus.
    if (window.location.hash.includes('access_token') || window.location.hash.includes('error')) {
      history.replaceState?.(null, '', window.location.pathname + window.location.search);
    }
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    let alive = true;
    fetchProfile(userId)
      .then((p) => {
        if (!alive) return;
        if (!p) {
          setError('Profil introuvable. Contactez un administrateur.');
          signOut();
        } else setProfile(p);
      })
      .catch((e) => alive && setError(frError(e)));
    return () => {
      alive = false;
    };
  }, [userId]);

  if (session === undefined || (session && !profile && !error && !needPassword)) {
    return (
      <div className="app">
        <div className="busy">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const header = (
    <header className="topbar">
      <Brand />
    </header>
  );

  if (!session) {
    return (
      <div className="app">
        {header}
        <Login key="sign-in" mode="sign-in" initialError={error} />
      </div>
    );
  }

  if (needPassword) {
    return (
      <div className="app">
        {header}
        <Login
          key="set-password"
          mode="set-password"
          invited={authLinkType === 'invite'}
          onPasswordSet={() => {
            setNeedPassword(false);
            // Le nom saisi à l'invitation est relu.
            fetchProfile(session.user.id).then((p) => p && setProfile(p));
          }}
        />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app">
        {header}
        <Login key="err" mode="sign-in" initialError={error} />
      </div>
    );
  }

  return <App cloud={{ profile, onProfileChange: setProfile, onSignOut: () => signOut() }} />;
}
