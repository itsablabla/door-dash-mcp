/**
 * State Manager
 * Centralized state management with Craft persistence
 */

import { CraftClient } from '../integrations/craft';
import { BeeperClient } from '../integrations/beeper';
import {
  AppState,
  Cart,
  CartItem,
  Order,
  OrderStatus,
  Session,
} from './types';

const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class StateManager {
  private craft: CraftClient;
  private beeper: BeeperClient;
  private state: AppState;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private dirty: boolean = false;

  constructor(craft: CraftClient, beeper: BeeperClient) {
    this.craft = craft;
    this.beeper = beeper;
    this.state = this.getDefaultState();
  }

  /**
   * Get default empty state
   */
  private getDefaultState(): AppState {
    return {
      session: {
        authenticated: false,
        lastActive: '',
        cookies: '',
        email: '',
      },
      cart: null,
      activeOrder: null,
      deliveryAddress: '',
      lastPatternHeal: '',
      notificationInterval: null,
    };
  }

  /**
   * Initialize state from Craft
   */
  async initialize(): Promise<void> {
    const savedState = await this.craft.loadState();

    this.state = {
      ...this.getDefaultState(),
      ...savedState,
    };

    // Start auto-save
    this.startAutoSave();
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      if (this.dirty) {
        await this.save();
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  /**
   * Save state to Craft
   */
  async save(): Promise<void> {
    await this.craft.saveState({
      session: this.state.session,
      cart: this.state.cart,
      activeOrder: this.state.activeOrder,
      deliveryAddress: this.state.deliveryAddress,
    });
    this.dirty = false;
  }

  /**
   * Mark state as dirty (needs saving)
   */
  private markDirty(): void {
    this.dirty = true;
  }

  // Session Management

  getSession(): Session {
    return this.state.session;
  }

  async setSession(session: Session): Promise<void> {
    this.state.session = session;
    this.markDirty();
    await this.save();
  }

  updateSessionActivity(): void {
    this.state.session.lastActive = new Date().toISOString();
    this.markDirty();
  }

  // Delivery Address

  getDeliveryAddress(): string {
    return this.state.deliveryAddress;
  }

  async setDeliveryAddress(address: string): Promise<void> {
    this.state.deliveryAddress = address;
    this.markDirty();
    await this.save();
  }

  // Cart Management

  getCart(): Cart | null {
    return this.state.cart;
  }

  async createCart(restaurantId: string, restaurantName: string): Promise<Cart> {
    this.state.cart = {
      restaurantId,
      restaurantName,
      items: [],
      subtotal: 0,
      deliveryFee: 0,
      serviceFee: 0,
      tax: 0,
      total: 0,
      deliveryAddress: this.state.deliveryAddress,
    };
    this.markDirty();
    await this.save();
    return this.state.cart;
  }

  async addToCart(item: CartItem): Promise<Cart> {
    if (!this.state.cart) {
      throw new Error('No cart exists. Create a cart first.');
    }

    // Check if item already exists
    const existingIndex = this.state.cart.items.findIndex((i) => i.id === item.id);

    if (existingIndex >= 0) {
      this.state.cart.items[existingIndex].quantity += item.quantity;
    } else {
      this.state.cart.items.push(item);
    }

    this.recalculateCart();
    this.markDirty();
    await this.save();
    return this.state.cart;
  }

  async updateCartItem(itemId: string, updates: Partial<CartItem>): Promise<Cart | null> {
    if (!this.state.cart) return null;

    const itemIndex = this.state.cart.items.findIndex((i) => i.id === itemId);
    if (itemIndex < 0) return null;

    this.state.cart.items[itemIndex] = {
      ...this.state.cart.items[itemIndex],
      ...updates,
    };

    this.recalculateCart();
    this.markDirty();
    await this.save();
    return this.state.cart;
  }

  async removeFromCart(itemId: string): Promise<Cart | null> {
    if (!this.state.cart) return null;

    this.state.cart.items = this.state.cart.items.filter((i) => i.id !== itemId);

    this.recalculateCart();
    this.markDirty();
    await this.save();
    return this.state.cart;
  }

  async clearCart(): Promise<void> {
    this.state.cart = null;
    this.markDirty();
    await this.save();
  }

  private recalculateCart(): void {
    if (!this.state.cart) return;

    // Calculate subtotal
    this.state.cart.subtotal = this.state.cart.items.reduce((sum, item) => {
      const customizationTotal = item.customizations.reduce(
        (cSum, c) => cSum + c.priceModifier,
        0
      );
      return sum + (item.price + customizationTotal) * item.quantity;
    }, 0);

    // Estimate fees (these would come from DoorDash in reality)
    this.state.cart.deliveryFee = 2.99;
    this.state.cart.serviceFee = Math.round(this.state.cart.subtotal * 0.15 * 100) / 100;
    this.state.cart.tax = Math.round(this.state.cart.subtotal * 0.0825 * 100) / 100;

    this.state.cart.total =
      this.state.cart.subtotal +
      this.state.cart.deliveryFee +
      this.state.cart.serviceFee +
      this.state.cart.tax;

    // Round to 2 decimal places
    this.state.cart.total = Math.round(this.state.cart.total * 100) / 100;
  }

  // Order Management

  getActiveOrder(): Order | null {
    return this.state.activeOrder;
  }

  async createOrder(orderId: string, tip: number): Promise<Order> {
    if (!this.state.cart) {
      throw new Error('No cart to create order from');
    }

    this.state.activeOrder = {
      id: orderId,
      restaurantId: this.state.cart.restaurantId,
      restaurantName: this.state.cart.restaurantName,
      status: 'pending',
      items: [...this.state.cart.items],
      total: this.state.cart.total + tip,
      createdAt: new Date().toISOString(),
      deliveryAddress: this.state.cart.deliveryAddress,
      tip,
    };

    // Clear cart after order
    this.state.cart = null;

    this.markDirty();
    await this.save();

    // Notify via Beeper
    await this.beeper.notifyOrderPlaced(this.state.activeOrder);

    return this.state.activeOrder;
  }

  async updateOrderStatus(status: OrderStatus, eta?: string, driver?: { name: string; vehicleType?: string }): Promise<Order | null> {
    if (!this.state.activeOrder) return null;

    const previousStatus = this.state.activeOrder.status;
    this.state.activeOrder.status = status;

    if (eta) {
      this.state.activeOrder.estimatedDelivery = eta;
    }

    if (driver) {
      this.state.activeOrder.driver = driver;
    }

    this.markDirty();
    await this.save();

    // Notify on status change
    if (status !== previousStatus) {
      if (status === 'delivered') {
        await this.beeper.notifyDelivered(this.state.activeOrder);
      } else {
        await this.beeper.notifyOrderStatus(this.state.activeOrder);
      }
    }

    return this.state.activeOrder;
  }

  async clearActiveOrder(): Promise<void> {
    this.state.activeOrder = null;
    this.markDirty();
    await this.save();
  }

  // Notification Interval

  setNotificationInterval(interval: NodeJS.Timeout): void {
    // Clear existing if any
    if (this.state.notificationInterval) {
      clearInterval(this.state.notificationInterval);
    }
    this.state.notificationInterval = interval;
  }

  clearNotificationInterval(): void {
    if (this.state.notificationInterval) {
      clearInterval(this.state.notificationInterval);
      this.state.notificationInterval = null;
    }
  }

  // Cleanup

  async cleanup(): Promise<void> {
    // Save any pending changes
    if (this.dirty) {
      await this.save();
    }

    // Stop auto-save
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Stop notification interval
    this.clearNotificationInterval();
  }
}
