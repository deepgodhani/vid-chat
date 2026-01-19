import React, { useState } from 'react';
import { supabase } from '../supabase';
import { Mail, Loader } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // Supabase Magic Link Login
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        // This redirects them back to your app after clicking the email link
        emailRedirectTo: window.location.origin, 
      }
    });

    if (error) {
      alert(error.error_description || error.message);
    } else {
      setMessage('Check your email for the login link!');
    }
    setLoading(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-900 text-white font-sans">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-96 border border-gray-700">
        <h1 className="text-3xl font-bold mb-2 text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
          Video Chat Pro
        </h1>
        <p className="text-gray-400 text-center mb-8">Sign in without a password</p>
        
        {message ? (
          <div className="bg-green-500/20 border border-green-500 text-green-200 p-3 rounded mb-4 text-center">
            {message}
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Email Address</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>

            <button 
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="animate-spin" size={20} /> : <Mail size={20} />}
              {loading ? 'Sending Link...' : 'Send Magic Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;