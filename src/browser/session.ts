/**
 * DoorDash Session Management
 * Manages browser session state and navigation
 */

import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { CraftClient } from '../integrations/craft';
import { PatternHealer } from '../patterns/pattern-healer';
import { Session } from '../state/types';

const DOORDASH_BASE_URL = 'https://www.doordash.com';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private browser: ShoppingTravelClient;
  private craft: CraftClient;
  private healer: PatternHealer;
  private session: Session | null = null;
  private lastActivity: Date | null = null;

  constructor(browser: ShoppingTravelClient, craft: CraftClient, healer: PatternHealer) {
    this.browser = browser;
    this.craft = craft;
    this.healer = healer;
  }

  /**
   * Initialize session from stored state
   */
  async initialize(): Promise<void> {
    const state = await this.craft.loadState();
    if (state.session) {
      this.session = state.session;
      this.lastActivity = new Date(state.session.lastActive);
    }
  }

  /**
   * Check if session is valid
   */
  isSessionValid(): boolean {
    if (!this.session?.authenticated) {
      return false;
    }

    if (!this.lastActivity) {
      return false;
    }

    // Check if session has timed out
    const now = new Date();
    const timeSinceActivity = now.getTime() - this.lastActivity.getTime();
    return timeSinceActivity < SESSION_TIMEOUT_MS;
  }

  /**
   * Update session activity timestamp
   */
  updateActivity(): void {
    this.lastActivity = new Date();
    if (this.session) {
      this.session.lastActive = this.lastActivity.toISOString();
    }
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Set session after login
   */
  async setSession(session: Session): Promise<void> {
    this.session = session;
    this.lastActivity = new Date();
    await this.craft.saveSession(session);
  }

  /**
   * Clear session (logout)
   */
  async clearSession(): Promise<void> {
    this.session = null;
    this.lastActivity = null;
  }

  /**
   * Navigate to a DoorDash page
   */
  async navigateTo(path: string): Promise<void> {
    const url = path.startsWith('http') ? path : `${DOORDASH_BASE_URL}${path}`;
    await this.browser.navigate(url);
    this.updateActivity();
  }

  /**
   * Navigate to home page
   */
  async goToHome(): Promise<void> {
    await this.navigateTo('/');
  }

  /**
   * Navigate to restaurant page
   */
  async goToRestaurant(restaurantId: string): Promise<void> {
    await this.navigateTo(`/store/${restaurantId}`);
  }

  /**
   * Navigate to cart
   */
  async goToCart(): Promise<void> {
    // Click cart button or navigate
    try {
      const cartRef = await this.healer.findElement('cart_button');
      await this.browser.clickRef(cartRef, 'Cart button');
    } catch {
      // Fallback to direct navigation
      await this.navigateTo('/cart');
    }
  }

  /**
   * Navigate to checkout
   */
  async goToCheckout(): Promise<void> {
    await this.navigateTo('/checkout');
  }

  /**
   * Navigate to orders page
   */
  async goToOrders(): Promise<void> {
    await this.navigateTo('/orders');
  }

  /**
   * Navigate to order tracking
   */
  async goToOrderTracking(orderId?: string): Promise<void> {
    if (orderId) {
      await this.navigateTo(`/orders/${orderId}`);
    } else {
      await this.navigateTo('/orders/active');
    }
  }

  /**
   * Wait for page to load
   */
  async waitForPageLoad(timeout: number = 5000): Promise<void> {
    // Wait a moment for dynamic content
    await new Promise((resolve) => setTimeout(resolve, timeout));
  }

  /**
   * Get current page snapshot
   */
  async getSnapshot(filtered: boolean = true): Promise<string> {
    return await this.browser.snapshot(filtered);
  }

  /**
   * Get current page text
   */
  async getPageText(): Promise<string> {
    return await this.browser.getText();
  }

  /**
   * Take screenshot
   */
  async screenshot(fullPage: boolean = false): Promise<string> {
    return await this.browser.screenshot(fullPage);
  }

  /**
   * Click element using pattern
   */
  async clickPattern(patternKey: string): Promise<void> {
    const ref = await this.healer.findElement(patternKey);
    const pattern = this.healer.getPattern(patternKey);
    await this.browser.clickRef(ref, pattern?.description || patternKey);
    this.updateActivity();
  }

  /**
   * Type into element using pattern
   */
  async typeInPattern(patternKey: string, text: string, submit: boolean = false): Promise<void> {
    const ref = await this.healer.findElement(patternKey);
    const pattern = this.healer.getPattern(patternKey);
    await this.browser.typeRef(ref, pattern?.description || patternKey, text, submit);
    this.updateActivity();
  }

  /**
   * Scroll to element using pattern
   */
  async scrollToPattern(patternKey: string): Promise<void> {
    const ref = await this.healer.findElement(patternKey);
    const pattern = this.healer.getPattern(patternKey);
    await this.browser.scrollToRef(ref, pattern?.description || patternKey);
  }

  /**
   * Check if we're on a specific page type
   */
  async isOnPage(pageType: 'home' | 'restaurant' | 'cart' | 'checkout' | 'orders'): Promise<boolean> {
    const snapshot = await this.browser.snapshot(true);
    const text = snapshot.toLowerCase();

    switch (pageType) {
      case 'home':
        return text.includes('delivery') && text.includes('pickup');
      case 'restaurant':
        return text.includes('add to order') || text.includes('menu');
      case 'cart':
        return text.includes('your cart') || text.includes('checkout');
      case 'checkout':
        return text.includes('place order') || text.includes('payment');
      case 'orders':
        return text.includes('order history') || text.includes('past orders');
      default:
        return false;
    }
  }
}
