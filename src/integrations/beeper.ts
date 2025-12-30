/**
 * Beeper MCP Integration
 * Wrapper for sending notifications via Beeper
 */

import { Order, OrderStatus } from '../state/types';

export interface BeeperConfig {
  chatId: string;
}

export class BeeperClient {
  private mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  private chatId: string;

  constructor(
    mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    config: BeeperConfig
  ) {
    this.mcpCallHandler = mcpCallHandler;
    this.chatId = config.chatId;
  }

  /**
   * Send a message to the configured chat
   */
  async sendMessage(text: string): Promise<{ success: boolean }> {
    try {
      const result = await this.mcpCallHandler('send_message', {
        chatID: this.chatId,
        text,
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to send Beeper message:', error);
      return { success: false };
    }
  }

  /**
   * Send order confirmation notification
   */
  async notifyOrderPlaced(order: Order): Promise<void> {
    const message = `🍕 DoorDash Order Placed!

Restaurant: ${order.restaurantName}
Items: ${order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
Total: $${order.total.toFixed(2)}

Estimated Delivery: ${order.estimatedDelivery || 'Calculating...'}
Order ID: ${order.id}

I'll keep you updated on the status!`;

    await this.sendMessage(message);
  }

  /**
   * Send order status update
   */
  async notifyOrderStatus(order: Order): Promise<void> {
    const statusEmoji = this.getStatusEmoji(order.status);
    const statusText = this.getStatusText(order.status);

    let message = `${statusEmoji} DoorDash Update

Restaurant: ${order.restaurantName}
Status: ${statusText}`;

    if (order.estimatedDelivery) {
      message += `\nETA: ${order.estimatedDelivery}`;
    }

    if (order.driver) {
      message += `\n\nDriver: ${order.driver.name}`;
      if (order.driver.vehicleType) {
        message += ` (${order.driver.vehicleType})`;
      }
    }

    await this.sendMessage(message);
  }

  /**
   * Send delivery complete notification
   */
  async notifyDelivered(order: Order): Promise<void> {
    const message = `✅ Your DoorDash order has arrived!

Restaurant: ${order.restaurantName}
Items: ${order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}

Enjoy your meal! 🍽️`;

    await this.sendMessage(message);
  }

  /**
   * Send error notification
   */
  async notifyError(error: string, context?: string): Promise<void> {
    let message = `⚠️ DoorDash MCP Error

${error}`;

    if (context) {
      message += `\n\nContext: ${context}`;
    }

    await this.sendMessage(message);
  }

  /**
   * Send pattern healing notification (for debugging)
   */
  async notifyPatternHealed(patternKey: string, change: string): Promise<void> {
    const message = `🔧 DoorDash MCP Self-Healed

Pattern: ${patternKey}
Change: ${change}

The automation adapted to a UI change.`;

    await this.sendMessage(message);
  }

  private getStatusEmoji(status: OrderStatus): string {
    const emojis: Record<OrderStatus, string> = {
      pending: '⏳',
      confirmed: '✅',
      preparing: '👨‍🍳',
      ready_for_pickup: '📦',
      picked_up: '🚗',
      on_the_way: '🛵',
      delivered: '✅',
      cancelled: '❌',
    };
    return emojis[status] || '📋';
  }

  private getStatusText(status: OrderStatus): string {
    const texts: Record<OrderStatus, string> = {
      pending: 'Order Pending',
      confirmed: 'Order Confirmed',
      preparing: 'Being Prepared',
      ready_for_pickup: 'Ready for Pickup',
      picked_up: 'Driver Picked Up',
      on_the_way: 'On the Way',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return texts[status] || status;
  }
}
