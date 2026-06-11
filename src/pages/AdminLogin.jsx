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

  useEffect(() => {
    const initGoogle = () => {
      if (!window.google?.accounts?.id) return;
      
      try {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              setError('');
              setLoading(true);
              const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ credential: response.credential }),
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
          },
        });

        // The target width (max-w-md padding taken into account)
        window.google.accounts.id.renderButton(
          document.getElementById('google-signIn-btn'),
          { theme: 'filled_black', size: 'large', type: 'standard', width: 380, shape: 'rectangular' }
        );
      } catch (err) {
        console.error("Google init failed", err);
      }
    };

    if (window.google?.accounts?.id) {
      initGoogle();
    } else {
      // Wait for script to load
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          initGoogle();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
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
        <div className="bg-[#1A1A1A] border border-[#d4af37]/20 rounded-xl overflow-hidden shadow-2xl">
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
              <div id="google-signIn-btn"></div>
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
