import { useEffect, useId, useState } from 'react';
import { AnimatePresence, m, useAnimationControls } from 'framer-motion';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context.jsx';
import { ease } from '../lib/motion.js';

const REMEMBER_KEY = 'scm.lastEmail';
const readRemembered = () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } };
const writeRemembered = v => { try { v ? localStorage.setItem(REMEMBER_KEY, v) : localStorage.removeItem(REMEMBER_KEY); } catch { /* private mode */ } };

const FEATURES = [
  ['truck', 'Dispatch & GST billing', 'Weighbridge slips, tax invoices and challans in seconds'],
  ['box', 'Stock, royalty & machinery', 'Live stock, permit balance, diesel and service alerts'],
  ['wallet', 'Accounts & payroll', 'Ledgers, ageing, cash book, wages and GST returns'],
];

/** Contour-line pattern for the brand panel (quarry / terrain feel), drawn once as SVG. */
function Contours() {
  const lines = Array.from({ length: 14 }, (_, i) => {
    const r = 60 + i * 46;
    return <ellipse key={i} cx="78%" cy="18%" rx={r * 1.35} ry={r} />;
  });
  return (
    <svg className="auth-contours" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke="currentColor" strokeWidth="1">{lines}</g>
    </svg>
  );
}

function BrandMark({ logo, size = 40 }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="auth-mark" style={{ width: size, height: size }}>
      {logo && !bad ? <img src={logo} alt="" onError={() => setBad(true)} /> : <Icon name="mountain" size={size * 0.5} strokeWidth={2} />}
    </span>
  );
}

/** Split layout: brand story on the left (hidden on phones), the form on the right. */
function AuthLayout({ title, subtitle, children, eyebrow }) {
  const { brand } = useAuth();
  const name = brand?.businessName || 'Stone Crusher Manager';
  return (
    <div className="auth">
      <aside className="auth-hero">
        <Contours />
        <div className="auth-hero-top">
          <BrandMark logo={brand?.logo} />
          <div>
            <div className="auth-hero-name">{name}</div>
            <div className="auth-hero-sub">Business Manager</div>
          </div>
        </div>
        <m.div className="auth-hero-body" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.1 } }}>
          <h2>Every load, bill and rupee of your crusher, in one place.</h2>
          <ul className="auth-features">
            {FEATURES.map(([icon, t, d], i) => (
              <m.li key={t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.45, ease, delay: 0.25 + i * 0.08 } }}>
                <span className="auth-feature-icon"><Icon name={icon} size={18} /></span>
                <span><b>{t}</b><small>{d}</small></span>
              </m.li>
            ))}
          </ul>
        </m.div>
        <div className="auth-hero-foot"><Icon name="lock" size={14} /> Encrypted sessions · role-based access · full audit trail</div>
      </aside>

      <main className="auth-main">
        <div className="auth-mobile-brand">
          <BrandMark logo={brand?.logo} size={36} />
          <span>{name}</span>
        </div>
        <m.div className="auth-panel" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease } }}>
          {eyebrow && <div className="auth-eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </m.div>
        <div className="auth-legal">© {new Date().getFullYear()} {name}</div>
      </main>
    </div>
  );
}

/** Text input with a leading icon; password inputs get a show/hide button and a Caps Lock hint. */
function AuthInput({ icon, label, type = 'text', error, hint, value, onChange, ...rest }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const isPw = type === 'password';
  const capsCheck = e => setCaps(Boolean(e.getModifierState?.('CapsLock')));
  return (
    <div className={`auth-field ${error ? 'invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        <Icon name={icon} size={17} />
        <input id={id} type={isPw && show ? 'text' : type} value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={isPw ? capsCheck : undefined} onKeyUp={isPw ? capsCheck : undefined} onBlur={() => setCaps(false)}
          aria-invalid={Boolean(error)} {...rest} />
        {isPw && (
          <button type="button" className="auth-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} tabIndex={-1}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {caps && (
          <m.div className="auth-caps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Icon name="capsLock" size={13} /> Caps Lock is on
          </m.div>
        )}
      </AnimatePresence>
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

function SubmitButton({ busy, children, busyText }) {
  return (
    <m.button className="btn btn-primary auth-submit" disabled={busy} whileTap={{ scale: 0.985 }}>
      {busy ? <><span className="spinner sm" /> {busyText}</> : <>{children} <Icon name="arrowRight" size={16} /></>}
    </m.button>
  );
}

/** Error banner that shakes once each time a new error appears. */
function useShake(error) {
  const controls = useAnimationControls();
  useEffect(() => {
    if (error) controls.start({ x: [0, -8, 7, -5, 3, 0], transition: { duration: 0.4 } });
  }, [error, controls]);
  return controls;
}

function ErrorBanner({ error }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <m.div key="err" className="auth-alert" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <Icon name="alert" size={16} /> <span>{error}</span>
        </m.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- Password strength (guidance only; the server enforces the rules) ---------------- */
function strength(pw) {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || /\s/.test(pw)) s++;
  if (pw.length < 10 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) s = Math.min(s, 1);
  const score = Math.min(4, s);
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}
function StrengthMeter({ value }) {
  const { score, label } = strength(value);
  if (!value) return <div className="field-hint">At least 10 characters with letters and numbers. A few unrelated words work well, e.g. “Gravel Truck 8842”.</div>;
  return (
    <div className="strength" data-score={score}>
      <div className="strength-bars">{[1, 2, 3, 4].map(i => <span key={i} className={i <= score ? 'on' : ''} />)}</div>
      <span className="strength-label">{label}</span>
    </div>
  );
}

/* ---------------- Screens ---------------- */
export function Login() {
  const { login, expired } = useAuth();
  const remembered = readRemembered();
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shake = useShake(error);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      writeRemembered(remember ? email.trim().toLowerCase() : '');
      await login(email, password);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in to your account" subtitle="Use the email and password your administrator gave you.">
      {expired && !error && <div className="auth-note"><Icon name="clock" size={16} /> Your session ended. Please sign in again.</div>}
      <m.form className="auth-form" onSubmit={submit} animate={shake} noValidate={false}>
        <ErrorBanner error={error} />
        <AuthInput icon="mail" label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} required autoFocus={!remembered} placeholder="you@company.com" />
        <AuthInput icon="lock" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required autoFocus={Boolean(remembered)} placeholder="Your password" />
        <div className="auth-row">
          <label className="auth-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember my email</label>
        </div>
        <SubmitButton busy={busy} busyText="Signing in…">Sign in</SubmitButton>
      </m.form>
      <p className="auth-footnote">Forgot your password? Ask your administrator to reset it from <b>Users & Access</b>.</p>
    </AuthLayout>
  );
}

export function Setup() {
  const { setup } = useAuth();
  const [v, setV] = useState({ setupCode: '', name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shake = useShake(error);
  const set = k => val => { setV(x => ({ ...x, [k]: val })); setErrors(e => ({ ...e, [k]: undefined })); };

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (v.password !== v.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      await setup({ setupCode: v.setupCode, name: v.name, email: v.email, password: v.password });
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow="First-time setup" title="Create the administrator" subtitle="This account manages users, settings and backups. You only do this once.">
      <div className="auth-note"><Icon name="key" size={16} /> Enter the one-time setup code shown in the server console when it started.</div>
      <m.form className="auth-form" onSubmit={submit} animate={shake}>
        <ErrorBanner error={error} />
        <AuthInput icon="key" label="Setup code" value={v.setupCode} onChange={set('setupCode')} error={errors.setupCode} autoComplete="off" required autoFocus />
        <AuthInput icon="user" label="Your name" value={v.name} onChange={set('name')} error={errors.name} autoComplete="name" required />
        <AuthInput icon="mail" label="Email" type="email" value={v.email} onChange={set('email')} error={errors.email} autoComplete="username" required />
        <div>
          <AuthInput icon="lock" label="Password" type="password" value={v.password} onChange={set('password')} error={errors.password} autoComplete="new-password" required />
          {!errors.password && <StrengthMeter value={v.password} />}
        </div>
        <AuthInput icon="lock" label="Confirm password" type="password" value={v.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" required />
        <SubmitButton busy={busy} busyText="Creating…">Create account</SubmitButton>
      </m.form>
    </AuthLayout>
  );
}

/** Shown right after sign-in when the administrator set (or reset) this person's password. */
export function ChoosePassword() {
  const { user, changePassword, logout } = useAuth();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shake = useShake(error);
  const set = k => val => { setV(x => ({ ...x, [k]: val })); setErrors(e => ({ ...e, [k]: undefined })); };

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (v.next !== v.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      await changePassword(v.current, v.next);
    } catch (err) {
      const f = err.fields || {};
      setErrors({ current: f.currentPassword, next: f.newPassword });
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow={`Hi ${user.name.split(' ')[0]}`} title="Choose your own password"
      subtitle="Your password was set by an administrator. Pick a new one that only you know before continuing.">
      <m.form className="auth-form" onSubmit={submit} animate={shake}>
        <ErrorBanner error={error} />
        <AuthInput icon="lock" label="Current (temporary) password" type="password" value={v.current} onChange={set('current')} error={errors.current} autoComplete="current-password" required autoFocus />
        <div>
          <AuthInput icon="key" label="New password" type="password" value={v.next} onChange={set('next')} error={errors.next} autoComplete="new-password" required />
          {!errors.next && <StrengthMeter value={v.next} />}
        </div>
        <AuthInput icon="key" label="Confirm new password" type="password" value={v.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" required />
        <SubmitButton busy={busy} busyText="Saving…">Save and continue</SubmitButton>
      </m.form>
      <button type="button" className="btn btn-ghost auth-signout" onClick={logout}><Icon name="logout" size={15} /> Sign out</button>
    </AuthLayout>
  );
}
