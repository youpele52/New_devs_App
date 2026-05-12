// Local authentication client to replace Supabase
interface AuthUser {
  id: string;
  email: string;
  name?: string;
  is_admin?: boolean;
  tenant_id?: string;
  app_metadata?: any;
  user_metadata?: any;
  created_at?: string;
}

interface AuthSession {
  access_token: string;
  refresh_token?: string;
  user: AuthUser;
  token_type: string;
  expires_in?: number;
}

interface AuthResponse {
  user: AuthUser | null;
  session: AuthSession | null;
  error: Error | null;
}

interface SignInCredentials {
  email: string;
  password: string;
}

class LocalAuthClient {
  private subscribers: ((event: string, session: AuthSession | null) => void)[] = [];
  private session: AuthSession | null = null;
  private storageKey = 'base360-auth-token';

  constructor() {
    this.loadSession();
  }

  private getApiUrl(): string {
    return import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  }

  private notifySubscribers(event: string, session: AuthSession | null) {
    console.log(`📣 [LocalAuth] Notifying ${this.subscribers.length} subscribers of event: ${event}`);
    this.subscribers.forEach((callback) => {
      try {
        callback(event, session);
      } catch (e) {
        console.error('📣 [LocalAuth] Error in subscriber callback:', e);
      }
    });
  }

  private saveSession(session: AuthSession | null) {
    this.session = session;
    if (session) {
      localStorage.setItem(this.storageKey, JSON.stringify(session));
      this.notifySubscribers('SIGNED_IN', session);
    } else {
      localStorage.removeItem(this.storageKey);
      this.notifySubscribers('SIGNED_OUT', null);
    }
  }

  private loadSession() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.session = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('[LocalAuth] Failed to load session from storage:', error);
      localStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Checks whether a JWT access token is expired (or within a 60-second grace
   * buffer). Decodes the payload locally — no network request required.
   *
   * Returns false (treat as valid) when the token cannot be decoded so we
   * never accidentally log the user out due to a parse error.
   */
  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      // Not a standard three-part JWT (e.g. a test/mock token) — treat as valid
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      if (typeof payload.exp !== 'number') return false;
      // 60-second buffer so we don't use a token that expires mid-request
      return (Date.now() / 1000) > (payload.exp - 60);
    } catch {
      // Cannot decode the payload — assume valid rather than signing out
      return false;
    }
  }

  async signInWithPassword(credentials: SignInCredentials): Promise<AuthResponse> {
    try {
      const response = await fetch(`${this.getApiUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || `HTTP ${response.status}`);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      const session: AuthSession = {
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        user: data.user,
      };

      this.saveSession(session);

      return {
        user: data.user,
        session: session,
        error: null,
      };
    } catch (error: any) {
      console.error('[LocalAuth] Sign in failed:', error);
      return {
        user: null,
        session: null,
        error: error,
      };
    }
  }

  async signOut(): Promise<{ error: Error | null }> {
    try {
      // Call backend logout endpoint if needed
      if (this.session?.access_token) {
        try {
          await fetch(`${this.getApiUrl()}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.session.access_token}`,
            },
          });
        } catch (logoutError) {
          console.warn('[LocalAuth] Backend logout failed (continuing):', logoutError);
        }
      }

      this.saveSession(null);

      return { error: null };
    } catch (error: any) {
      console.error('[LocalAuth] Sign out failed:', error);
      return { error: error };
    }
  }

  /**
   * Returns the current session WITHOUT making any network request.
   *
   * Previously this method called /api/v1/auth/me on every invocation which
   * caused random logouts on page refresh because:
   *   1. Many parts of the app call getSession() simultaneously at startup.
   *   2. Any single network hiccup (timeout, transient error) would call
   *      saveSession(null), fire SIGNED_OUT, and log the user out.
   *
   * Now we check the JWT expiry claim locally (no HTTP). The backend already
   * validates the JWT signature on every actual API call, so there is no
   * security regression.
   */
  async getSession(): Promise<{ data: { session: AuthSession | null } }> {
    if (this.session?.access_token) {
      if (this.isTokenExpired(this.session.access_token)) {
        console.warn('[LocalAuth] Session token expired — clearing');
        this.saveSession(null);
        return { data: { session: null } };
      }
      return { data: { session: this.session } };
    }
    return { data: { session: null } };
  }

  /**
   * "Refreshes" the session for Supabase-compatible callers such as
   * SessionPersistenceManager.
   *
   * This auth system issues plain JWTs without a refresh-token mechanism, so
   * a true token rotation is not possible here. Instead we:
   *   • Return the current session if the token is still valid.
   *   • Return an "Auth session missing" error if the token has expired, which
   *     tells SessionPersistenceManager to stop retrying gracefully.
   *
   * A proper refresh endpoint can be added to the backend later and wired in
   * here without changing any callers.
   */
  async refreshSession(): Promise<{ data: { session: AuthSession | null }; error: Error | null }> {
    if (!this.session?.access_token) {
      return { data: { session: null }, error: new Error('Auth session missing') };
    }
    if (this.isTokenExpired(this.session.access_token)) {
      console.warn('[LocalAuth] Cannot refresh — token expired');
      this.saveSession(null);
      return { data: { session: null }, error: new Error('Auth session missing') };
    }
    // Token is still valid — return it as-is
    console.log('[LocalAuth] refreshSession: token still valid, returning current session');
    return { data: { session: this.session }, error: null };
  }

  async getUser(token?: string): Promise<{ user: AuthUser | null }> {
    const tokenToUse = token || this.session?.access_token;

    if (!tokenToUse) {
      return { user: null };
    }

    try {
      const response = await fetch(`${this.getApiUrl()}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${tokenToUse}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        return { user: userData };
      } else {
        return { user: null };
      }
    } catch (error) {
      console.error('[LocalAuth] Get user failed:', error);
      return { user: null };
    }
  }

  async setSession(session: AuthSession): Promise<{ error: Error | null }> {
    try {
      this.saveSession(session);
      return { error: null };
    } catch (error: any) {
      return { error: error };
    }
  }

  // Auth state change handler (Supabase-compatible interface)
  onAuthStateChange(callback: (event: string, session: AuthSession | null) => void) {
    // Register subscriber
    this.subscribers.push(callback);

    // Fire immediately with the current in-memory session so callers don't
    // need to also call getSession() to bootstrap
    callback('INITIAL_SESSION', this.session);

    // Return unsubscribe function
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.subscribers = this.subscribers.filter(cb => cb !== callback);
          },
        },
      },
    };
  }

  // Supabase-compatible auth interface
  get auth() {
    return {
      admin: {
        getUser: this.getUser.bind(this),
        getUserById: (_id: string) => this.getUser(),
        listUsers: () => Promise.resolve([]),
      },
      signInWithPassword: this.signInWithPassword.bind(this),
      signOut: this.signOut.bind(this),
      getSession: this.getSession.bind(this),
      refreshSession: this.refreshSession.bind(this),
      getUser: this.getUser.bind(this),
      setSession: this.setSession.bind(this),
      onAuthStateChange: this.onAuthStateChange.bind(this),
    };
  }
}


export const localAuthClient = new LocalAuthClient();
export default localAuthClient;
