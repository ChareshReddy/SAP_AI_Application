import crypto from 'crypto';

class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
    this.DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

    // Periodic cleanup of expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    // Prevent interval from keeping the Node process alive when exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Generates a cryptographically secure random session ID (64 hex characters)
   * @returns {string}
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Stores encrypted credentials in-memory.
   * Never stores raw passwords.
   * @param {string} encryptedCredentials 
   * @param {string} username 
   * @param {number} ttlMs 
   * @returns {string} sessionId
   */
  createSession(encryptedCredentials, username, ttlMs = this.DEFAULT_TTL_MS) {
    const sessionId = this.generateSessionId();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    this.sessions.set(sessionId, {
      sessionId,
      username,
      encryptedCredentials,
      createdAt: now,
      expiresAt
    });

    return sessionId;
  }

  /**
   * Retrieves active session. Returns null if expired or missing.
   * @param {string} sessionId 
   * @returns {object|null}
   */
  getSession(sessionId) {
    if (!sessionId || !this.sessions.has(sessionId)) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Destroys a session on logout.
   * @param {string} sessionId 
   * @returns {boolean}
   */
  deleteSession(sessionId) {
    if (!sessionId) return false;
    return this.sessions.delete(sessionId);
  }

  /**
   * Removes all expired sessions from memory.
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Returns current count of active sessions.
   */
  getActiveSessionCount() {
    this.cleanupExpiredSessions();
    return this.sessions.size;
  }
}

export const sessionStore = new InMemorySessionStore();
