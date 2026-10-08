import { useState, type FormEvent } from 'react';
import { frError, sendPasswordReset, setPassword, signIn, signUp } from '../lib/cloud';

interface Props {
  /** "set-password" : l'utilisateur arrive d'un lien d'invitation ou de réinitialisation. */
  mode: 'sign-in' | 'set-password';
  invited?: boolean;
  initialError?: string | null;
  /** L'utilisateur revient du lien de confirmation de son adresse. */
  confirmed?: boolean;
  onPasswordSet?: () => void;
}

export default function Login({ mode, invited, initialError, confirmed, onPasswordSet }: Props) {
  const [view, setView] = useState<'sign-in' | 'sign-up' | 'forgot' | 'set-password'>(mode);
  const [email, setEmail] = useState('');
  const [password, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(confirmed && !initialError ? 'Adresse confirmée : connectez-vous.' : null);
  const [loading, setLoading] = useState(false);

  const go = (v: typeof view) => {
    setView(v);
    setError(null);
    setInfo(null);
  };

  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(frError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="landing auth">
      <div className="auth-card">

        {view === 'sign-in' && (
          <form onSubmit={(e) => run(e, () => signIn(email, password))}>
            <h1 className="auth-title">Connexion</h1>
            <label className="lbl">
              <span>E-mail</span>
              <input
                className="field"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="lbl">
              <span>Mot de passe</span>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPwd(e.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            {info && <p className="form-info">{info}</p>}
            <button className="btn primary wide" disabled={loading}>
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
            <button type="button" className="btn outline wide" onClick={() => go('sign-up')}>
              Créer un compte
            </button>
            <button type="button" className="link center" onClick={() => go('forgot')}>
              Mot de passe oublié
            </button>
          </form>
        )}

        {view === 'sign-up' && (
          <form
            onSubmit={(e) =>
              run(e, async () => {
                if (password.length < 8) throw new Error('Password should be at least 8 characters');
                if (password !== confirm) {
                  setError('Les deux mots de passe ne correspondent pas.');
                  return;
                }
                const mailSent = await signUp(email, password, fullName);
                // Sans confirmation par e-mail, la session s'ouvre directement et l'app s'affiche.
                if (mailSent) setInfo(`E-mail envoyé à ${email.trim()} : cliquez sur le lien pour activer le compte.`);
              })
            }
          >
            <h1 className="auth-title">Créer un compte</h1>
            <label className="lbl">
              <span>Prénom et nom</span>
              <input
                className="field"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
            <label className="lbl">
              <span>E-mail professionnel</span>
              <input
                className="field"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="lbl">
              <span>Mot de passe (8 caractères min.)</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPwd(e.target.value)}
              />
            </label>
            <label className="lbl">
              <span>Confirmation</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            {info && <p className="form-info">{info}</p>}
            <button className="btn primary wide" disabled={loading || !!info}>
              {loading ? 'Création…' : 'Créer le compte'}
            </button>
            <button type="button" className="link center" onClick={() => go('sign-in')}>
              J’ai déjà un compte
            </button>
          </form>
        )}

        {view === 'forgot' && (
          <form
            onSubmit={(e) =>
              run(e, async () => {
                await sendPasswordReset(email);
                setInfo('E-mail envoyé.');
              })
            }
          >
            <h1 className="auth-title">Mot de passe oublié</h1>
            <label className="lbl">
              <span>E-mail</span>
              <input
                className="field"
                type="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            {info && <p className="form-info">{info}</p>}
            <button className="btn primary wide" disabled={loading}>
              Envoyer le lien
            </button>
            <button type="button" className="link center" onClick={() => go('sign-in')}>
              Retour
            </button>
          </form>
        )}

        {view === 'set-password' && (
          <form
            onSubmit={(e) =>
              run(e, async () => {
                if (password.length < 8) throw new Error('Password should be at least 8 characters');
                if (password !== confirm) {
                  setError('Les deux mots de passe ne correspondent pas.');
                  return;
                }
                await setPassword(password, invited ? fullName : undefined);
                onPasswordSet?.();
              })
            }
          >
            <h1 className="auth-title">{invited ? 'Activer le compte' : 'Nouveau mot de passe'}</h1>
            {invited && (
              <label className="lbl">
                <span>Prénom et nom</span>
                <input className="field" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </label>
            )}
            <label className="lbl">
              <span>Mot de passe (8 caractères min.)</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPwd(e.target.value)}
              />
            </label>
            <label className="lbl">
              <span>Confirmation</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary wide" disabled={loading}>
              Enregistrer
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
