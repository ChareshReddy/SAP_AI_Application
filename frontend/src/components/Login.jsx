import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, User, AlertCircle, Server, KeyRound, Info } from 'lucide-react';
import { loginUser, getAuthConfig } from '../services/api';

export default function Login({ onLoginSuccess, authConfig }) {
  const [config, setConfig] = useState(authConfig || null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!config) {
      getAuthConfig().then(setConfig).catch(() => {});
    }
  }, [config]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both SAP username and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await loginUser(username.trim(), password);
      // Immediately clear raw password from component state
      setPassword('');
      if (result.success) {
        onLoginSuccess({
          username: result.username,
          sapMode: result.sapMode
        });
      }
    } catch (err) {
      setPassword(''); // Never keep failed password in state
      if (err.response?.status === 429) {
        setErrorMessage(
          err.response?.data?.error ||
          'Too many login attempts. The endpoint is rate-limited for security. Please wait before trying again.'
        );
      } else if (err.response?.status === 401) {
        setErrorMessage('Invalid SAP Gateway credentials. Please verify your username and password.');
      } else {
        setErrorMessage(
          err.response?.data?.error ||
          'Connection to SAP backend service failed. Please ensure backend is running.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillDemo = () => {
    setUsername('SAP_CONSULTANT');
    setPassword('Init@2026');
    setErrorMessage('');
  };

  return (
    <div className="sap-login-viewport">
      <div className="sap-login-card">
        <div className="sap-login-header">
          <div style={{
            background: '#0070f2',
            borderRadius: 8,
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Server size={24} color="#fff" />
          </div>
          <div>
            <h2>SAP Gateway Login</h2>
            <p>S/4HANA OData Service Authentication</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="sap-login-body">
          {errorMessage && (
            <div className="sap-alert sap-alert-error" role="alert">
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>{errorMessage}</div>
            </div>
          )}

          <div className="sap-alert sap-alert-info">
            <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: '12px' }}>
              {config?.mockMode ? (
                <>
                  <strong>Mock Gateway Active (Demo Credentials Available)</strong>
                  <div style={{ marginTop: 2, color: '#334155' }}>
                    Simulated SAP OData environment. Click below to fill demo credentials or enter custom test credentials.
                  </div>
                  <button
                    type="button"
                    onClick={handleFillDemo}
                    style={{
                      color: '#0070f2',
                      fontWeight: 600,
                      marginTop: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: '12px',
                      textDecoration: 'underline'
                    }}
                  >
                    <KeyRound size={13} />
                    Quick-fill Demo Credentials
                  </button>
                </>
              ) : (
                <>
                  <strong>Live SAP Gateway Authentication</strong>
                  <div style={{ marginTop: 2, color: '#334155' }}>
                    Enter your SAP NetWeaver / S/4HANA credentials to authenticate against the live OData service.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sap-form-group">
            <label className="sap-form-label" htmlFor="sap-username">
              SAP Username
            </label>
            <div className="sap-input-group">
              <input
                id="sap-username"
                type="text"
                className="sap-input"
                placeholder="e.g. S4H_USER or CONSULTANT"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div className="sap-form-group">
            <label className="sap-form-label" htmlFor="sap-password">
              SAP Password
            </label>
            <div className="sap-input-group">
              <input
                id="sap-password"
                type={showPassword ? 'text' : 'password'}
                className="sap-input"
                placeholder="Enter SAP Gateway password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="sap-input-addon-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="sap-btn sap-btn-primary"
            disabled={isLoading}
            style={{ width: '100%', height: 42, fontSize: 14, marginTop: 6 }}
          >
            {isLoading ? (
              <>
                <span className="sap-spinner" />
                <span>Authenticating with SAP...</span>
              </>
            ) : (
              <>
                <Lock size={16} />
                <span>Log In to Gateway</span>
              </>
            )}
          </button>

          <div style={{
            textAlign: 'center',
            fontSize: '11px',
            color: '#94a3b8',
            marginTop: 4,
            lineHeight: 1.4
          }}>
            Protected by AES-256 encrypted session store &amp; HttpOnly cookies.
            <br />
            Browser never communicates directly with SAP Gateway.
          </div>
        </form>
      </div>
    </div>
  );
}
