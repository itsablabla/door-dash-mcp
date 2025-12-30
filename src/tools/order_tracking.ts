/**
 * Order Tracking Tool
 * Track active orders with real-time updates and Beeper notifications
 */

import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { BeeperClient } from '../integrations/beeper';
import { ClaudeClient } from '../claude/client';
import { StateManager } from '../state/manager';
import { ToolResult, OrderStatus } from '../state/types';

const NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class OrderTrackingTool {
  private navigation: NavigationHelper;
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private beeper: BeeperClient;
  private claude: ClaudeClient;
  private state: StateManager;
  private lastNotifiedStatus: OrderStatus | null = null;

  constructor(
    navigation: NavigationHelper,
    session: SessionManager,
    browser: ShoppingTravelClient,
    beeper: BeeperClient,
    claude: ClaudeClient,
    state: StateManager
  ) {
    this.navigation = navigation;
    this.session = session;
    this.browser = browser;
    this.beeper = beeper;
    this.claude = claude;
    this.state = state;
  }

  /**
   * Track current order status
   */
  async trackOrder(): Promise<ToolResult> {
    try {
      const order = this.state.getActiveOrder();

      if (!order) {
        return {
          success: false,
          error: 'No active order to track.',
        };
      }

      // Navigate to order tracking
      await this.navigation.ensureReady();
      await this.session.goToOrderTracking(order.id);
      await this.wait(2500);

      // Get page content
      const snapshot = await this.browser.snapshot(true);
      const pageText = await this.browser.getText();
      const screenshot = await this.browser.screenshot(false);

      // Use Claude to parse order status
      const statusInfo = await this.claude.parseOrderStatus(pageText, screenshot);

      // Update order state
      const updatedOrder = await this.state.updateOrderStatus(
        statusInfo.status as OrderStatus,
        statusInfo.eta || undefined,
        statusInfo.driver || undefined
      );

      if (!updatedOrder) {
        return {
          success: false,
          error: 'Failed to update order status',
        };
      }

      // Start notification interval if not already running
      this.startNotificationInterval();

      // Format output
      let output = `# Order Tracking\n\n`;
      output += `## ${updatedOrder.restaurantName}\n\n`;
      output += `**Status:** ${this.getStatusDisplay(updatedOrder.status)}\n`;

      if (updatedOrder.estimatedDelivery) {
        output += `**ETA:** ${updatedOrder.estimatedDelivery}\n`;
      }

      if (updatedOrder.driver) {
        output += `\n### Driver\n`;
        output += `- Name: ${updatedOrder.driver.name}\n`;
        if (updatedOrder.driver.vehicleType) {
          output += `- Vehicle: ${updatedOrder.driver.vehicleType}\n`;
        }
      }

      output += `\n### Order Details\n`;
      output += `- Items: ${updatedOrder.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}\n`;
      output += `- Total: $${updatedOrder.total.toFixed(2)}\n`;
      output += `- Delivering to: ${updatedOrder.deliveryAddress}\n`;

      output += `\n---\n`;
      output += `Auto-updates via Beeper every 5 minutes while order is active.`;

      return {
        success: true,
        data: updatedOrder,
        message: output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start automatic notification interval
   */
  startNotificationInterval(): void {
    // Clear any existing interval
    this.state.clearNotificationInterval();

    const interval = setInterval(async () => {
      const order = this.state.getActiveOrder();

      if (!order) {
        this.state.clearNotificationInterval();
        return;
      }

      // Check if order is delivered
      if (order.status === 'delivered' || order.status === 'cancelled') {
        this.state.clearNotificationInterval();
        return;
      }

      try {
        // Get latest status
        await this.navigation.ensureReady();
        await this.session.goToOrderTracking(order.id);
        await this.wait(2000);

        const pageText = await this.browser.getText();
        const statusInfo = await this.claude.parseOrderStatus(pageText);

        // Update order
        await this.state.updateOrderStatus(
          statusInfo.status as OrderStatus,
          statusInfo.eta || undefined,
          statusInfo.driver || undefined
        );

        // Notification is sent by state manager on status change
        // But we also send periodic updates regardless
        if (this.shouldSendPeriodicNotification()) {
          const updatedOrder = this.state.getActiveOrder();
          if (updatedOrder) {
            await this.beeper.notifyOrderStatus(updatedOrder);
          }
        }
      } catch (error) {
        console.error('Failed to update order status:', error);
      }
    }, NOTIFICATION_INTERVAL_MS);

    this.state.setNotificationInterval(interval);
  }

  /**
   * Check if we should send a periodic notification
   */
  private shouldSendPeriodicNotification(): boolean {
    const order = this.state.getActiveOrder();
    if (!order) return false;

    // Always notify if status changed
    if (order.status !== this.lastNotifiedStatus) {
      this.lastNotifiedStatus = order.status;
      return false; // State manager already sent notification
    }

    // Send periodic update for active orders
    return ['preparing', 'picked_up', 'on_the_way'].includes(order.status);
  }

  /**
   * Get display text for order status
   */
  private getStatusDisplay(status: OrderStatus): string {
    const displays: Record<OrderStatus, string> = {
      pending: '⏳ Order Pending',
      confirmed: '✅ Order Confirmed',
      preparing: '👨‍🍳 Being Prepared',
      ready_for_pickup: '📦 Ready for Pickup',
      picked_up: '🚗 Driver Picked Up',
      on_the_way: '🛵 On the Way!',
      delivered: '✅ Delivered',
      cancelled: '❌ Cancelled',
    };
    return displays[status] || status;
  }

  /**
   * Stop tracking and clear order
   */
  async stopTracking(): Promise<ToolResult> {
    this.state.clearNotificationInterval();
    await this.state.clearActiveOrder();

    return {
      success: true,
      message: 'Order tracking stopped and cleared.',
    };
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const trackOrderSchema = {
  name: 'track_order',
  description: 'Get current order status and ETA. Automatically sends Beeper notifications.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export const stopTrackingSchema = {
  name: 'stop_tracking',
  description: 'Stop order tracking and clear active order',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
