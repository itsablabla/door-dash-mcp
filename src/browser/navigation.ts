/**
 * Smart Navigation Helpers
 * High-level navigation utilities for DoorDash
 */

import { SessionManager } from './session';
import { AuthManager } from './auth';
import { PatternHealer } from '../patterns/pattern-healer';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { PatternMatcher } from '../patterns/pattern-matcher';

export class NavigationHelper {
  private session: SessionManager;
  private auth: AuthManager;
  private healer: PatternHealer;
  private browser: ShoppingTravelClient;
  private matcher: PatternMatcher;

  constructor(
    session: SessionManager,
    auth: AuthManager,
    healer: PatternHealer,
    browser: ShoppingTravelClient
  ) {
    this.session = session;
    this.auth = auth;
    this.healer = healer;
    this.browser = browser;
    this.matcher = new PatternMatcher(browser);
  }

  /**
   * Ensure we're on DoorDash and authenticated
   */
  async ensureReady(): Promise<void> {
    await this.auth.ensureAuthenticated();
  }

  /**
   * Set delivery address
   */
  async setDeliveryAddress(address: string): Promise<boolean> {
    try {
      await this.session.goToHome();
      await this.wait(1500);

      // Find address input
      const addressRef = await this.healer.findElement('address_input');
      await this.browser.clickRef(addressRef, 'Address input');
      await this.wait(500);

      // Type address
      await this.browser.typeRef(addressRef, 'Address input', address, true);
      await this.wait(2000);

      // Look for address suggestion and click first one
      const snapshot = await this.browser.snapshot(true);
      const elements = this.matcher.parseSnapshot(snapshot);

      // Find suggestion elements (usually in a listbox or list)
      const suggestions = elements.filter(
        (el) =>
          el.role === 'option' ||
          el.role === 'listitem' ||
          (el.name?.toLowerCase().includes(address.toLowerCase().substring(0, 10)))
      );

      if (suggestions.length > 0) {
        await this.browser.clickRef(suggestions[0].ref, 'Address suggestion');
        await this.wait(1000);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to set delivery address:', error);
      return false;
    }
  }

  /**
   * Search for restaurants
   */
  async searchRestaurants(query: string): Promise<void> {
    await this.session.goToHome();
    await this.wait(1500);

    // Find search input
    const snapshot = await this.browser.snapshot(true);
    const searchRef = this.browser.findRefByText(snapshot, 'search', 'textbox');

    if (searchRef) {
      await this.browser.clickRef(searchRef, 'Search input');
      await this.wait(300);
      await this.browser.typeRef(searchRef, 'Search input', query, true);
      await this.wait(2000);
    }
  }

  /**
   * Navigate to specific cuisine category
   */
  async browseByCategory(category: string): Promise<void> {
    await this.session.goToHome();
    await this.wait(1500);

    const snapshot = await this.browser.snapshot(true);
    const categoryRef = this.browser.findRefByText(snapshot, category, 'link');

    if (categoryRef) {
      await this.browser.clickRef(categoryRef, `${category} category`);
      await this.wait(2000);
    }
  }

  /**
   * Open restaurant page
   */
  async openRestaurant(restaurantRef: string, restaurantName: string): Promise<void> {
    await this.browser.clickRef(restaurantRef, restaurantName);
    await this.wait(2000);
  }

  /**
   * Add item to cart from menu
   */
  async addItemToCart(itemRef: string, itemName: string): Promise<void> {
    // Click on the item
    await this.browser.clickRef(itemRef, itemName);
    await this.wait(1000);

    // Look for add to cart button
    const addRef = await this.healer.findElement('add_to_cart_button');
    await this.browser.clickRef(addRef, 'Add to cart');
    await this.wait(1000);
  }

  /**
   * Set item quantity
   */
  async setQuantity(quantity: number): Promise<void> {
    const snapshot = await this.browser.snapshot(true);

    // Find quantity controls
    const increaseRef = this.browser.findRefByText(snapshot, '+', 'button');
    const currentQuantity = this.extractCurrentQuantity(snapshot);

    if (increaseRef && quantity > currentQuantity) {
      for (let i = currentQuantity; i < quantity; i++) {
        await this.browser.clickRef(increaseRef, 'Increase quantity');
        await this.wait(300);
      }
    }
  }

  /**
   * Extract current quantity from snapshot
   */
  private extractCurrentQuantity(snapshot: string): number {
    const match = snapshot.match(/quantity[:\s]*(\d+)/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * Apply customization option
   */
  async selectCustomization(optionName: string): Promise<boolean> {
    const snapshot = await this.browser.snapshot(true);
    const optionRef = this.browser.findRefByText(snapshot, optionName);

    if (optionRef) {
      await this.browser.clickRef(optionRef, optionName);
      await this.wait(300);
      return true;
    }

    return false;
  }

  /**
   * Add special instructions
   */
  async addSpecialInstructions(instructions: string): Promise<boolean> {
    const snapshot = await this.browser.snapshot(true);
    const instructionsRef = this.browser.findRefByText(
      snapshot,
      'special instructions',
      'textbox'
    );

    if (instructionsRef) {
      await this.browser.typeRef(instructionsRef, 'Special instructions', instructions, false);
      return true;
    }

    return false;
  }

  /**
   * Proceed to checkout
   */
  async goToCheckout(): Promise<void> {
    const checkoutRef = await this.healer.findElement('checkout_button');
    await this.browser.clickRef(checkoutRef, 'Checkout button');
    await this.wait(2000);
  }

  /**
   * Select tip amount
   */
  async selectTip(amount: number): Promise<void> {
    const snapshot = await this.browser.snapshot(true);

    // Look for tip option matching amount
    const tipRef = this.browser.findRefByText(snapshot, `$${amount}`, 'button');

    if (tipRef) {
      await this.browser.clickRef(tipRef, `$${amount} tip`);
      await this.wait(500);
    }
  }

  /**
   * Select delivery option
   */
  async selectDeliveryOption(priority: 'standard' | 'priority'): Promise<void> {
    const snapshot = await this.browser.snapshot(true);

    const optionRef = this.browser.findRefByText(snapshot, priority);

    if (optionRef) {
      await this.browser.clickRef(optionRef, `${priority} delivery`);
      await this.wait(500);
    }
  }

  /**
   * Place the order (final step)
   */
  async placeOrder(): Promise<boolean> {
    try {
      const placeOrderRef = await this.healer.findElement('place_order_button');
      await this.browser.clickRef(placeOrderRef, 'Place order');
      await this.wait(3000);

      // Verify order was placed
      const snapshot = await this.browser.snapshot(true);
      const text = snapshot.toLowerCase();

      return (
        text.includes('order placed') ||
        text.includes('order confirmed') ||
        text.includes('your order')
      );
    } catch (error) {
      console.error('Failed to place order:', error);
      return false;
    }
  }

  /**
   * Get order tracking info
   */
  async getOrderTrackingInfo(): Promise<{
    status: string;
    eta: string | null;
    driver: string | null;
  } | null> {
    await this.session.goToOrderTracking();
    await this.wait(2000);

    const snapshot = await this.browser.snapshot(true);
    const text = snapshot.toLowerCase();

    // Parse status
    let status = 'unknown';
    if (text.includes('preparing')) status = 'preparing';
    else if (text.includes('picked up')) status = 'picked_up';
    else if (text.includes('on the way') || text.includes('en route')) status = 'on_the_way';
    else if (text.includes('delivered')) status = 'delivered';
    else if (text.includes('confirmed')) status = 'confirmed';

    // Extract ETA
    const etaMatch = snapshot.match(/(\d+)\s*min/i);
    const eta = etaMatch ? `${etaMatch[1]} minutes` : null;

    // Extract driver name
    const driverMatch = snapshot.match(/your\s+(?:driver|dasher)\s+(?:is\s+)?([A-Z][a-z]+)/i);
    const driver = driverMatch ? driverMatch[1] : null;

    return { status, eta, driver };
  }

  /**
   * Helper to wait
   */
  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
