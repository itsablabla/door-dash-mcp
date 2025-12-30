/**
 * Recent Orders Tool
 * Get order history with reorder capability
 */

import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { PatternHealer } from '../patterns/pattern-healer';
import { PatternMatcher } from '../patterns/pattern-matcher';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { StateManager } from '../state/manager';
import { ToolResult, RecentOrder } from '../state/types';

export interface RecentOrdersInput {
  limit?: number;
}

export class RecentOrdersTool {
  private navigation: NavigationHelper;
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private healer: PatternHealer;
  private state: StateManager;
  private matcher: PatternMatcher;

  constructor(
    navigation: NavigationHelper,
    session: SessionManager,
    browser: ShoppingTravelClient,
    healer: PatternHealer,
    state: StateManager
  ) {
    this.navigation = navigation;
    this.session = session;
    this.browser = browser;
    this.healer = healer;
    this.state = state;
    this.matcher = new PatternMatcher(browser);
  }

  async execute(input: RecentOrdersInput = {}): Promise<ToolResult> {
    try {
      const limit = input.limit || 10;

      // Ensure we're ready
      await this.navigation.ensureReady();

      // Navigate to orders page
      await this.session.goToOrders();
      await this.wait(2000);

      // Get page snapshot
      const snapshot = await this.browser.snapshot(true);
      const pageText = await this.browser.getText();

      // Parse orders from page
      const orders = this.parseOrders(snapshot, pageText, limit);

      // Format output
      const output = this.formatOutput(orders);

      return {
        success: true,
        data: orders,
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
   * Reorder a previous order
   */
  async reorder(orderId: string): Promise<ToolResult> {
    try {
      // Ensure we're ready
      await this.navigation.ensureReady();

      // Navigate to orders
      await this.session.goToOrders();
      await this.wait(2000);

      // Find and click reorder button for this order
      const snapshot = await this.browser.snapshot(true);
      const elements = this.matcher.parseSnapshot(snapshot);

      // Look for reorder button near the order
      let reorderRef: string | null = null;

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];

        // If we find the order ID or restaurant name
        if (el.name?.includes(orderId) || el.text?.includes(orderId)) {
          // Look for reorder button nearby
          for (let j = i; j < Math.min(i + 10, elements.length); j++) {
            const nearby = elements[j];
            if (
              nearby.role === 'button' &&
              nearby.name?.toLowerCase().includes('reorder')
            ) {
              reorderRef = nearby.ref;
              break;
            }
          }
        }
      }

      if (!reorderRef) {
        // Try to find any reorder button
        reorderRef = await this.healer.findElement('reorder_button');
      }

      if (reorderRef) {
        await this.browser.clickRef(reorderRef, 'Reorder button');
        await this.wait(2000);

        return {
          success: true,
          message: 'Items from previous order added to cart. Use review_order to see details.',
        };
      }

      return {
        success: false,
        error: 'Could not find reorder button for this order',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseOrders(snapshot: string, pageText: string, limit: number): RecentOrder[] {
    const orders: RecentOrder[] = [];
    const elements = this.matcher.parseSnapshot(snapshot);

    // Look for order patterns in the page
    // Orders typically show: restaurant name, date, items, total

    const orderBlocks: {
      restaurantName: string;
      date: string;
      items: string[];
      total: number;
      ref: string;
    }[] = [];

    let currentBlock: typeof orderBlocks[0] | null = null;

    for (const el of elements) {
      const text = `${el.name || ''} ${el.text || ''}`.toLowerCase();

      // Look for date patterns (indicates new order)
      if (text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i)) {
        if (currentBlock && currentBlock.restaurantName) {
          orderBlocks.push(currentBlock);
        }
        currentBlock = {
          restaurantName: '',
          date: el.name || el.text || '',
          items: [],
          total: 0,
          ref: el.ref,
        };
      }

      // Look for restaurant name (usually a link)
      if (currentBlock && el.role === 'link' && el.name && !currentBlock.restaurantName) {
        currentBlock.restaurantName = el.name;
        currentBlock.ref = el.ref;
      }

      // Look for price
      if (currentBlock) {
        const priceMatch = text.match(/\$(\d+\.?\d*)/);
        if (priceMatch) {
          currentBlock.total = parseFloat(priceMatch[1]);
        }
      }

      // Look for item names
      if (currentBlock && el.name && !el.name.match(/\$|order|reorder|view/i)) {
        // Could be an item name
        if (el.name.length > 3 && el.name.length < 100) {
          currentBlock.items.push(el.name);
        }
      }
    }

    // Don't forget the last block
    if (currentBlock && currentBlock.restaurantName) {
      orderBlocks.push(currentBlock);
    }

    // Convert to RecentOrder format
    for (const block of orderBlocks.slice(0, limit)) {
      orders.push({
        id: block.ref, // Use ref as ID for reordering
        restaurantName: block.restaurantName,
        items: block.items.slice(0, 5), // Limit items shown
        total: block.total,
        date: block.date,
        canReorder: true, // Assume we can reorder
      });
    }

    return orders;
  }

  private formatOutput(orders: RecentOrder[]): string {
    if (orders.length === 0) {
      return 'No recent orders found.';
    }

    let output = '# Recent Orders\n\n';

    for (const order of orders) {
      output += `## ${order.restaurantName}\n`;
      output += `- Date: ${order.date}\n`;
      if (order.items.length > 0) {
        output += `- Items: ${order.items.join(', ')}\n`;
      }
      if (order.total > 0) {
        output += `- Total: $${order.total.toFixed(2)}\n`;
      }
      if (order.canReorder) {
        output += `- *Can reorder* (ID: ${order.id})\n`;
      }
      output += '\n';
    }

    return output;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const recentOrdersSchema = {
  name: 'get_recent_orders',
  description: 'Get order history with reorder capability',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of orders to return (default: 10)',
      },
    },
  },
};

export const reorderSchema = {
  name: 'reorder',
  description: 'Reorder a previous order by its ID',
  inputSchema: {
    type: 'object' as const,
    properties: {
      order_id: {
        type: 'string',
        description: 'The order ID to reorder (from get_recent_orders)',
      },
    },
    required: ['order_id'],
  },
};
