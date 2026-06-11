import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = mode === 'register' ? { name, email, password } : { email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }

      navigate('/admin/dashboard');
    } catch (err) {
      setError('Unable to connect to server. Is the backend running?');
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError('Google Client ID is missing in environment variables.');
      return;
    }
    const redirectUri = window.location.origin + window.location.pathname;
    const nonce = Math.random().toString(36).substring(2);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=id_token&scope=email%20profile%20openid&nonce=${nonce}&prompt=select_account`;
    window.location.href = url;
  };

  useEffect(() => {
    // Check if returning from Google OAuth redirect with id_token in hash
    const hash = window.location.hash;
    if (hash && hash.includes('id_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const idToken = params.get('id_token');
      
      if (idToken) {
        // Clear the hash from URL so it's not visible
        window.history.replaceState(null, '', window.location.pathname);
        
        const loginWithGoogle = async () => {
          try {
            setError('');
            setLoading(true);
            const res = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ credential: idToken }),
            });
            const data = await res.json();
            if (!res.ok) {
              setError(data.error || 'Google sign-in failed.');
              setLoading(false);
              return;
            }
            navigate('/admin/dashboard');
          } catch {
            setError('Server error during Google sign-in.');
            setLoading(false);
          }
        };
        loginWithGoogle();
      }
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4"
          >
            <span className="material-symbols-outlined text-primary text-3xl">restaurant</span>
          </motion.div>
          <h1 className="font-display-lg-mobile text-display-lg-mobile text-primary tracking-tight">Aurum Table</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2">Admin Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-surface-container border border-primary/20 rounded-xl overflow-hidden shadow-2xl">
          {/* Tabs */}
          <div className="flex border-b border-outline-variant/20">
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-4 font-label-caps text-label-caps uppercase tracking-widest transition-all ${
                mode === 'login'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-4 font-label-caps text-label-caps uppercase tracking-widest transition-all ${
                mode === 'register'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Register
            </button>
          </div>

          <div className="p-6">
            {/* Google Sign-In */}
            <div className="w-full flex justify-center mb-6">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full bg-white text-black font-body-md py-3 rounded-lg flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors shadow-sm"
              >
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-outline-variant/30" />
              <span className="font-label-caps text-label-caps text-on-surface-variant/50 uppercase tracking-widest">or</span>
              <div className="flex-1 h-px bg-outline-variant/30" />
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest block mb-2">Full Name</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">person</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      required
                      className="w-full bg-surface-container-high border border-outline-variant text-on-surface pl-10 pr-4 py-3 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-body-md placeholder-on-surface-variant/40"
                    />
                  </div>
                </motion.div>
              )}

              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest block mb-2">Email</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">mail</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@aurumtable.com"
                    required
                    className="w-full bg-surface-container-high border border-outline-variant text-on-surface pl-10 pr-4 py-3 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-body-md placeholder-on-surface-variant/40"
                  />
                </div>
              </div>

              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest block mb-2">Password</label>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined absolute left-3 text-on-surface-variant text-[20px]">lock</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full bg-surface-container-high border border-outline-variant text-on-surface pl-10 pr-12 py-3 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors font-body-md text-body-md placeholder-on-surface-variant/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 font-body-md text-[14px] flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gold-metallic text-on-primary font-label-caps text-label-caps py-4 rounded-lg uppercase tracking-wider gold-glow transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                ) : (
                  <>
                    {mode === 'register' ? 'Create Account' : 'Sign In'}
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Back to menu */}
        <div className="text-center mt-6">
          <a href="/" className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Menu
          </a>
        </div>
      </motion.div>
    </div>
  );
}
