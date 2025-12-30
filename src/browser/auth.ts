/**
 * DoorDash Authentication
 * Handles login flow and session management
 */

import { SessionManager } from './session';
import { PatternHealer } from '../patterns/pattern-healer';
import { CraftClient } from '../integrations/craft';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { Session, AuthenticationError } from '../state/types';

const DOORDASH_LOGIN_URL = 'https://www.doordash.com/consumer/login';

export interface AuthConfig {
  email: string;
  password: string;
}

export class AuthManager {
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private healer: PatternHealer;
  private craft: CraftClient;
  private credentials: AuthConfig;

  constructor(
    session: SessionManager,
    browser: ShoppingTravelClient,
    healer: PatternHealer,
    craft: CraftClient,
    credentials: AuthConfig
  ) {
    this.session = session;
    this.browser = browser;
    this.healer = healer;
    this.craft = craft;
    this.credentials = credentials;
  }

  /**
   * Ensure we're authenticated, logging in if necessary
   */
  async ensureAuthenticated(): Promise<boolean> {
    // Check if we have a valid session
    if (this.session.isSessionValid()) {
      return true;
    }

    // Try to login
    return await this.login();
  }

  /**
   * Perform login flow
   */
  async login(): Promise<boolean> {
    try {
      // Navigate to login page
      await this.browser.navigate(DOORDASH_LOGIN_URL);
      await this.waitForLoad();

      // Get initial snapshot
      let snapshot = await this.browser.snapshot(true);

      // Check if already logged in (might have valid cookies)
      if (await this.isLoggedIn(snapshot)) {
        await this.createSessionFromCurrentState();
        return true;
      }

      // Find and fill email
      const emailRef = await this.healer.findElement('login_email_input');
      await this.browser.typeRef(emailRef, 'Email input', this.credentials.email, true);
      await this.waitForLoad();

      // Check for password field (might be on same page or next)
      snapshot = await this.browser.snapshot(true);

      // Find and fill password
      const passwordRef = await this.healer.findElement('login_password_input');
      await this.browser.typeRef(passwordRef, 'Password input', this.credentials.password, false);
      await this.waitForLoad();

      // Click submit/sign in button
      const submitRef = await this.healer.findElement('login_submit_button');
      await this.browser.clickRef(submitRef, 'Sign in button');
      await this.waitForLoad(3000);

      // Verify login success
      snapshot = await this.browser.snapshot(true);
      if (await this.isLoggedIn(snapshot)) {
        await this.createSessionFromCurrentState();
        console.log('Login successful');
        return true;
      }

      // Check for error messages
      const errorMessage = this.extractLoginError(snapshot);
      if (errorMessage) {
        throw new AuthenticationError(`Login failed: ${errorMessage}`);
      }

      throw new AuthenticationError('Login failed: Could not verify authentication');
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        `Login error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if user is logged in
   */
  async isLoggedIn(snapshot?: string): Promise<boolean> {
    const currentSnapshot = snapshot || (await this.browser.snapshot(true));
    const text = currentSnapshot.toLowerCase();

    // Look for signs of being logged in
    const loggedInIndicators = [
      'account',
      'your orders',
      'delivery address',
      'sign out',
      'logout',
    ];

    const loggedOutIndicators = [
      'sign in',
      'log in',
      'create account',
      'sign up',
    ];

    // Check for logged in indicators
    const hasLoggedInIndicator = loggedInIndicators.some((indicator) =>
      text.includes(indicator)
    );

    // Make sure we're not on login page
    const hasLoggedOutIndicator = loggedOutIndicators.some((indicator) =>
      text.includes(indicator) && !text.includes('sign out')
    );

    return hasLoggedInIndicator && !hasLoggedOutIndicator;
  }

  /**
   * Create session object from current browser state
   */
  private async createSessionFromCurrentState(): Promise<void> {
    // Get page HTML to extract any cookies/session info
    // In a real implementation, we'd extract cookies from the browser
    // For now, we mark the session as authenticated

    const session: Session = {
      authenticated: true,
      lastActive: new Date().toISOString(),
      cookies: '', // Would be extracted from browser
      email: this.credentials.email,
    };

    await this.session.setSession(session);
  }

  /**
   * Extract login error message from page
   */
  private extractLoginError(snapshot: string): string | null {
    const text = snapshot.toLowerCase();

    const errorPatterns = [
      /invalid.*email/i,
      /invalid.*password/i,
      /incorrect.*password/i,
      /account.*not.*found/i,
      /too.*many.*attempts/i,
      /please.*try.*again/i,
    ];

    for (const pattern of errorPatterns) {
      const match = snapshot.match(pattern);
      if (match) {
        return match[0];
      }
    }

    // Check for generic error indicators
    if (text.includes('error') || text.includes('failed')) {
      return 'Authentication failed';
    }

    return null;
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      // Navigate to account settings
      await this.browser.navigate('https://www.doordash.com/consumer/account');
      await this.waitForLoad();

      // Look for sign out button
      const snapshot = await this.browser.snapshot(true);
      const signOutRef = this.browser.findRefByText(snapshot, 'sign out', 'button');

      if (signOutRef) {
        await this.browser.clickRef(signOutRef, 'Sign out button');
        await this.waitForLoad();
      }

      // Clear session
      await this.session.clearSession();
    } catch (error) {
      // Clear session even if browser logout fails
      await this.session.clearSession();
    }
  }

  /**
   * Wait for page to load
   */
  private async waitForLoad(ms: number = 2000): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
