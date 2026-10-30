import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, GraduationCap, KeyRound, LockKeyhole, Mail, UserRound } from "lucide-react";
import { getAuthRedirectUrl, supabase } from "../../lib/supabase.js";
import styles from "./Login.module.css";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordScore = (value) => [value.length >= 8, /[a-z]/.test(value) && /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
function authErrorMessage(error) {
  const message = error?.message || "Authentication failed. Please try again.";
  if (/failed to fetch|network|networkerror/i.test(message)) return "We couldn't reach the authentication service. Check your connection and try again.";
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Please verify your email before signing in.";
  if (/already registered|already exists|duplicate/i.test(message)) return "An account with this email already exists.";
  return message;
}

export default function Login({ onLogin, initialMode, onExitRecovery }) {
  const [mode, setMode] = useState(initialMode || "login"); const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [registeredEmail, setRegisteredEmail] = useState("");
  const strength = useMemo(() => passwordScore(password), [password]);

  useEffect(() => {
    if (!supabase) return undefined;
    const url = new URL(window.location.href); const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const isRecovery = url.pathname === "/auth/callback" && (url.searchParams.get("type") === "recovery" || hash.get("type") === "recovery");
    const callbackError = url.searchParams.get("error_description") || hash.get("error_description");
    if (callbackError) { setMode("callback-error"); setError(callbackError); window.history.replaceState({}, "", "/"); return undefined; }
    if (isRecovery) { setMode("reset"); return undefined; }
    if (url.pathname === "/auth/callback" && url.searchParams.get("code")) {
      setMode("callback");
      supabase.auth.exchangeCodeForSession(url.searchParams.get("code")).then(({ data, error: exchangeError }) => {
        if (exchangeError || !data.session) { setMode("callback-error"); setError(authErrorMessage(exchangeError || new Error("This verification link is invalid or has expired."))); return; }
        window.history.replaceState({}, "", "/"); onLogin?.(data.user);
      });
    }
    return undefined;
  }, [onLogin]);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  function changeMode(nextMode) { setMode(nextMode); setError(""); setMessage(""); }
  async function handleSubmit(event) {
    event.preventDefault(); setError(""); setMessage("");
    if (!supabase) return setError("Supabase is not configured. Check your .env file.");
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailPattern.test(normalizedEmail)) return setError("Enter a valid email address.");
    if (mode === "signup") {
      if (name.trim().length < 2) return setError("Please enter your full name.");
      if (strength < 3) return setError("Use at least 8 characters with upper and lower case letters and a number.");
      if (password !== confirmPassword) return setError("Passwords do not match.");
      if (!termsAccepted) return setError("Please accept the Terms and Privacy Policy.");
    } else if (!password) return setError("Enter your password.");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({ email: normalizedEmail, password, options: { data: { full_name: name.trim() }, emailRedirectTo: getAuthRedirectUrl() } });
        if (authError) throw authError;
        setRegisteredEmail(normalizedEmail); setMode("verify");
        if (data.user?.identities?.length === 0) setMessage("If this address can receive a verification email, we have sent one.");
        else if (data.session && data.user) onLogin?.(data.user);
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (authError) throw authError; onLogin?.(data.user);
      }
    } catch (err) { const friendly = authErrorMessage(err); setError(friendly); if (/already exists/i.test(friendly)) setMode("existing"); }
    finally { setLoading(false); }
  }
  async function handleResend() {
    if (!supabase || !registeredEmail) return; setLoading(true); setError(""); setMessage("");
    try {
      const { error: resendError } = await supabase.auth.resend({ type: "signup", email: registeredEmail, options: { emailRedirectTo: getAuthRedirectUrl() } });
      if (resendError) throw resendError;
      setMessage("If this address is awaiting verification, a new link has been sent.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  async function handleForgotPassword(event) {
    event.preventDefault(); setError(""); setMessage(""); const normalizedEmail = email.trim().toLowerCase();
    if (!supabase) return setError("Supabase is not configured. Check your .env file."); if (!emailPattern.test(normalizedEmail)) return setError("Enter a valid email address.");
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: getAuthRedirectUrl() });
      if (resetError) throw resetError;
      setMessage("If an account uses this address, we have sent password reset instructions.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  async function handleResetPassword(event) {
    event.preventDefault(); setError(""); setMessage(""); if (strength < 3) return setError("Use at least 8 characters with upper and lower case letters and a number."); if (password !== confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw new Error("Your password was updated, but we could not sign you out. Please try again.");
      setMessage("Your password has been updated. You can now sign in.");
      window.history.replaceState({}, "", "/");
      onExitRecovery?.();
      setTimeout(() => changeMode("login"), 1200);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  async function handleGoogle() { if (!supabase) return setError("Supabase is not configured. Check your .env file."); setLoading(true); setError(""); const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: getAuthRedirectUrl() } }); if (oauthError) { setLoading(false); setError(authErrorMessage(oauthError)); } }

  const passwordPage = mode === "signup" || mode === "reset";
  const title = mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome back";
  const isStatus = ["verify", "existing", "callback", "callback-error"].includes(mode);
  return <main className={styles.page}><div className={styles.glowOne}/><div className={styles.glowTwo}/><section className={styles.layout}>
    <aside className={styles.brandPanel}><div className={styles.brand}><span className={styles.brandIcon}><GraduationCap size={27}/></span><span>Study Sync</span></div><div className={styles.brandContent}><span className={styles.eyebrow}>YOUR CAMPUS. YOUR FUTURE.</span><h1>Make your<br/>next chapter<br/><span>count.</span></h1><p>Your learning space for class notes, study materials, courses and academic progress—all in one place.</p></div><div className={styles.brandFooter}>BUILT FOR STUDENT SUCCESS</div></aside>
    <div className={styles.formPanel}><div className={styles.mobileBrand}><GraduationCap size={25}/><strong>Study Sync</strong></div>
      {isStatus ? <StatusScreen mode={mode} email={registeredEmail} error={error} message={message} loading={loading} onResend={handleResend} onLogin={() => changeMode("login")} onForgot={() => changeMode("forgot")}/> : <>
        <div className={styles.formHeading}><span className={styles.welcome}>{mode === "login" ? "WELCOME BACK" : mode === "signup" ? "GET STARTED" : "ACCOUNT RECOVERY"}</span><h2>{title}</h2><p>{mode === "forgot" ? "Enter your email and we’ll send a secure reset link." : mode === "reset" ? "Set a strong password for your Study Sync account." : mode === "login" ? "Sign in to access your learning space." : "Join Study Sync and organize your learning."}</p></div>
        {(mode === "login" || mode === "signup") && <><button type="button" className={styles.googleButton} onClick={handleGoogle} disabled={loading}><span className={styles.googleMark}>G</span>Continue with Google</button><div className={styles.divider}><span>OR CONTINUE WITH</span></div></>}
        <form className={styles.form} onSubmit={mode === "forgot" ? handleForgotPassword : mode === "reset" ? handleResetPassword : handleSubmit}>
          {mode === "signup" && <Field icon={<UserRound size={18}/>} label="Full name" type="text" value={name} onChange={setName} autoComplete="name" placeholder="Enter your full name"/>}
          {mode !== "reset" && <Field icon={<Mail size={18}/>} label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com"/>}
          {mode !== "forgot" && <PasswordField label="Password" value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} autoComplete={mode === "login" ? "current-password" : "new-password"}/>}
          {passwordPage && <><PasswordStrength score={strength}/><PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} show={showConfirmPassword} setShow={setShowConfirmPassword} autoComplete="new-password"/></>}
          {mode === "login" && <button type="button" className={styles.forgotPassword} onClick={() => changeMode("forgot")}>Forgot Password?</button>}
          {mode === "signup" && <label className={styles.terms}><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)}/> I accept the Terms of Service and Privacy Policy.</label>}
          <Alerts error={error} message={message}/><button className={styles.submit} type="submit" disabled={loading}><span>{loading ? "Please wait..." : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : "Sign in"}</span>{!loading && <ArrowRight size={18}/>}</button>
        </form>
        {mode === "forgot" ? <p className={styles.switchText}><button type="button" onClick={() => changeMode("login")}><ArrowLeft size={14}/> Back to sign in</button></p> : mode !== "reset" && <p className={styles.switchText}>{mode === "login" ? "New to Study Sync?" : "Already have an account?"} <button type="button" onClick={() => changeMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create account" : "Sign in"}</button></p>}
      </>}<div className={styles.security}><LockKeyhole size={14}/><span>Your account is secured with Supabase Auth.</span></div></div>
  </section></main>;
}
function Field({ icon, label, value, onChange, ...props }) { return <label className={styles.field}><span>{label}</span><div className={styles.inputWrap}>{icon}<input value={value} onChange={(event) => onChange(event.target.value)} required {...props}/></div></label>; }
function PasswordField({ label, value, onChange, show, setShow, autoComplete }) { return <label className={styles.field}><span>{label}</span><div className={styles.inputWrap}><LockKeyhole size={18}/><input type={show ? "text" : "password"} placeholder="Enter your password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required/><button type="button" className={styles.eyeButton} onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>; }
function PasswordStrength({ score }) { const labels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"]; return <div className={styles.strength} aria-live="polite"><div>{[1,2,3,4].map((level) => <i key={level} className={level <= score ? styles[`strength${score}`] : ""}/>)}</div><span>{labels[score]}</span></div>; }
function Alerts({ error, message }) { return <>{error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.message} role="status">{message}</p>}</>; }
function StatusScreen({ mode, email, error, message, loading, onResend, onLogin, onForgot }) {
  if (mode === "callback") return <div className={styles.statusScreen}><KeyRound size={31}/><h2>Verifying your email</h2><p>We’re securely signing you in.</p></div>;
  if (mode === "callback-error") return <div className={styles.statusScreen}><KeyRound size={31}/><h2>We couldn’t verify that link</h2><p>This link may have expired or already been used. Request a new verification or password-reset email.</p><Alerts error={error}/><button className={styles.submit} onClick={onLogin}>Back to sign in</button></div>;
  if (mode === "existing") return <div className={styles.statusScreen}><Mail size={31}/><h2>An account with this email already exists.</h2><p>Sign in to continue, or reset your password if you cannot access your account.</p><button className={styles.submit} onClick={onLogin}>Sign in</button><button className={styles.textButton} onClick={onForgot}>Forgot Password?</button></div>;
  return <div className={styles.statusScreen}><Mail size={31}/><h2>Check your inbox</h2><p>We’ve sent a verification link to <strong>{email}</strong>.</p><Alerts error={error} message={message}/><button className={styles.submit} onClick={onResend} disabled={loading}>{loading ? "Sending..." : "Resend verification email"}</button><button className={styles.textButton} onClick={onLogin}>Back to sign in</button><button className={styles.textButton} onClick={onLogin}>Use a different email</button></div>;
}
