/**
 * Order Placement Tools
 * Review and place orders with safety checks
 */

import { v4 as uuidv4 } from 'uuid';
import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { PatternHealer } from '../patterns/pattern-healer';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { StateManager } from '../state/manager';
import { CraftClient } from '../integrations/craft';
import { ToolResult, OrderError } from '../state/types';

// Test mode - stops before actually placing order
const TEST_MODE = process.env.TEST_MODE === 'true';

export interface PlaceOrderInput {
  confirmation: string;
  tip_amount?: number;
  delivery_priority?: 'standard' | 'priority';
}

export class OrderPlacementTool {
  private navigation: NavigationHelper;
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private healer: PatternHealer;
  private state: StateManager;
  private craft: CraftClient;

  constructor(
    navigation: NavigationHelper,
    session: SessionManager,
    browser: ShoppingTravelClient,
    healer: PatternHealer,
    state: StateManager,
    craft: CraftClient
  ) {
    this.navigation = navigation;
    this.session = session;
    this.browser = browser;
    this.healer = healer;
    this.state = state;
    this.craft = craft;
  }

  /**
   * Review order before placing
   */
  async reviewOrder(): Promise<ToolResult> {
    try {
      const cart = this.state.getCart();

      if (!cart || cart.items.length === 0) {
        return {
          success: false,
          error: 'No items in cart. Build a cart first using build_cart.',
        };
      }

      // Navigate to checkout to get real pricing
      await this.navigation.ensureReady();
      await this.session.goToCart();
      await this.wait(2000);

      // Get checkout details from page
      const snapshot = await this.browser.snapshot(true);
      const pageText = await this.browser.getText();

      // Parse checkout details
      const checkoutDetails = this.parseCheckoutDetails(snapshot, pageText);

      // Build review output
      let output = `# Order Review\n\n`;
      output += `## Restaurant\n${cart.restaurantName}\n\n`;

      output += `## Items\n`;
      for (const item of cart.items) {
        output += `- ${item.quantity}x ${item.name} - $${(item.price * item.quantity).toFixed(2)}\n`;
        if (item.customizations.length > 0) {
          output += `  ${item.customizations.map((c) => c.name).join(', ')}\n`;
        }
        if (item.specialInstructions) {
          output += `  *${item.specialInstructions}*\n`;
        }
      }

      output += `\n## Delivery\n`;
      output += `- Address: ${cart.deliveryAddress || checkoutDetails.address || 'Not set'}\n`;
      if (checkoutDetails.deliveryTime) {
        output += `- Estimated: ${checkoutDetails.deliveryTime}\n`;
      }
      output += `- Options: Standard, Priority (+$${checkoutDetails.priorityFee?.toFixed(2) || '1.99'})\n`;

      output += `\n## Payment\n`;
      output += `- Method: ${checkoutDetails.paymentMethod || 'Card on file'}\n`;

      output += `\n## Fees Breakdown\n`;
      output += `- Subtotal: $${(checkoutDetails.subtotal || cart.subtotal).toFixed(2)}\n`;
      output += `- Delivery Fee: $${(checkoutDetails.deliveryFee || cart.deliveryFee).toFixed(2)}\n`;
      output += `- Service Fee: $${(checkoutDetails.serviceFee || cart.serviceFee).toFixed(2)}\n`;
      output += `- Tax: $${(checkoutDetails.tax || cart.tax).toFixed(2)}\n`;

      output += `\n## Tip Options\n`;
      output += `- 15%: $${(cart.subtotal * 0.15).toFixed(2)}\n`;
      output += `- 20%: $${(cart.subtotal * 0.2).toFixed(2)}\n`;
      output += `- 25%: $${(cart.subtotal * 0.25).toFixed(2)}\n`;
      output += `- Custom amount\n`;

      const total = checkoutDetails.total || cart.total;
      output += `\n## TOTAL (before tip)\n`;
      output += `# $${total.toFixed(2)}\n`;

      output += `\n---\n`;
      output += `**To place this order, use place_order with confirmation: "confirm" or "yes"**\n`;
      output += `You can also specify tip_amount and delivery_priority (standard/priority).\n`;

      return {
        success: true,
        data: {
          cart,
          checkoutDetails,
        },
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
   * Place the order - REQUIRES explicit confirmation
   */
  async placeOrder(input: PlaceOrderInput): Promise<ToolResult> {
    // CRITICAL: Require explicit confirmation
    const confirmationWords = ['confirm', 'yes', 'confirmed'];
    if (!confirmationWords.includes(input.confirmation.toLowerCase())) {
      return {
        success: false,
        error:
          'Order NOT placed. You must explicitly confirm with "confirm" or "yes". ' +
          'Use review_order first to see order details.',
      };
    }

    try {
      const cart = this.state.getCart();

      if (!cart || cart.items.length === 0) {
        return {
          success: false,
          error: 'No items in cart. Build a cart first.',
        };
      }

      // Ensure we're ready and on checkout
      await this.navigation.ensureReady();
      await this.session.goToCheckout();
      await this.wait(2000);

      // Select tip
      const tipAmount = input.tip_amount ?? Math.round(cart.subtotal * 0.2 * 100) / 100;
      await this.navigation.selectTip(tipAmount);
      await this.wait(500);

      // Select delivery option
      if (input.delivery_priority === 'priority') {
        await this.navigation.selectDeliveryOption('priority');
        await this.wait(500);
      }

      // TEST MODE: Stop before placing
      if (TEST_MODE) {
        console.log('TEST MODE: Would have placed order');
        console.log('Cart:', JSON.stringify(cart, null, 2));
        console.log('Tip:', tipAmount);
        console.log('Priority:', input.delivery_priority);

        return {
          success: true,
          data: { test: true, cart, tipAmount },
          message:
            '⚠️ TEST MODE: Order was NOT placed.\n\n' +
            'In production, this would have placed the order.\n' +
            `Cart total: $${cart.total.toFixed(2)}\n` +
            `Tip: $${tipAmount.toFixed(2)}`,
        };
      }

      // PLACE THE ORDER
      const orderPlaced = await this.navigation.placeOrder();

      if (!orderPlaced) {
        // Log error to Craft
        await this.craft.logError(
          new OrderError('Order placement failed'),
          'place_order'
        );

        return {
          success: false,
          error:
            'Failed to place order. Please check the DoorDash app directly. ' +
            'Your cart should still be saved.',
        };
      }

      // Generate order ID (would come from DoorDash in reality)
      const orderId = uuidv4();

      // Create order in state
      const order = await this.state.createOrder(orderId, tipAmount);

      let output = `# ✅ Order Placed!\n\n`;
      output += `Order ID: ${orderId}\n\n`;
      output += `## ${order.restaurantName}\n`;
      output += `Items: ${order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}\n`;
      output += `Total: $${order.total.toFixed(2)} (includes $${tipAmount.toFixed(2)} tip)\n\n`;
      output += `Delivery to: ${order.deliveryAddress}\n\n`;
      output += `I'll send you status updates via Beeper every 5 minutes.\n`;
      output += `Use track_order to check status anytime.`;

      return {
        success: true,
        data: order,
        message: output,
      };
    } catch (error) {
      // Log error
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.craft.logError(
        new OrderError(errorMessage),
        'place_order'
      );

      return {
        success: false,
        error: `Order failed: ${errorMessage}. Please check DoorDash app directly.`,
      };
    }
  }

  private parseCheckoutDetails(
    snapshot: string,
    pageText: string
  ): {
    subtotal?: number;
    deliveryFee?: number;
    serviceFee?: number;
    tax?: number;
    total?: number;
    priorityFee?: number;
    deliveryTime?: string;
    address?: string;
    paymentMethod?: string;
  } {
    const details: ReturnType<typeof this.parseCheckoutDetails> = {};
    const text = pageText.toLowerCase();

    // Extract prices
    const subtotalMatch = text.match(/subtotal[:\s]*\$?([\d.]+)/i);
    if (subtotalMatch) details.subtotal = parseFloat(subtotalMatch[1]);

    const deliveryMatch = text.match(/delivery(?:\s+fee)?[:\s]*\$?([\d.]+)/i);
    if (deliveryMatch) details.deliveryFee = parseFloat(deliveryMatch[1]);

    const serviceMatch = text.match(/service(?:\s+fee)?[:\s]*\$?([\d.]+)/i);
    if (serviceMatch) details.serviceFee = parseFloat(serviceMatch[1]);

    const taxMatch = text.match(/tax[:\s]*\$?([\d.]+)/i);
    if (taxMatch) details.tax = parseFloat(taxMatch[1]);

    const totalMatch = text.match(/total[:\s]*\$?([\d.]+)/i);
    if (totalMatch) details.total = parseFloat(totalMatch[1]);

    // Extract delivery time
    const timeMatch = text.match(/(\d+)\s*-\s*(\d+)\s*min/i);
    if (timeMatch) {
      details.deliveryTime = `${timeMatch[1]}-${timeMatch[2]} minutes`;
    }

    // Extract address
    const addressMatch = pageText.match(/deliver(?:ing)?\s+to[:\s]*([\w\s,]+\d{5})/i);
    if (addressMatch) details.address = addressMatch[1].trim();

    // Extract payment method
    if (text.includes('visa')) details.paymentMethod = 'Visa •••• on file';
    else if (text.includes('mastercard')) details.paymentMethod = 'Mastercard •••• on file';
    else if (text.includes('amex')) details.paymentMethod = 'Amex •••• on file';

    return details;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const reviewOrderSchema = {
  name: 'review_order',
  description: 'Review order before placing - shows all details including fees, delivery options, and tip',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export const placeOrderSchema = {
  name: 'place_order',
  description:
    'Place order - REQUIRES explicit confirmation. Always use review_order first!',
  inputSchema: {
    type: 'object' as const,
    properties: {
      confirmation: {
        type: 'string',
        description: 'Must be "confirm" or "yes" to place the order',
      },
      tip_amount: {
        type: 'number',
        description: 'Tip amount in dollars (default: 20% of subtotal)',
      },
      delivery_priority: {
        type: 'string',
        enum: ['standard', 'priority'],
        description: 'Delivery speed option (default: standard)',
      },
    },
    required: ['confirmation'],
  },
};
