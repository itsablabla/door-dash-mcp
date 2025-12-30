/**
 * Cart Management Tool
 * Add items to cart with customizations
 */

import { v4 as uuidv4 } from 'uuid';
import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { PatternHealer } from '../patterns/pattern-healer';
import { PatternMatcher } from '../patterns/pattern-matcher';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { StateManager } from '../state/manager';
import { ToolResult, CartItem, Customization } from '../state/types';

export interface CartItemInput {
  name: string;
  quantity?: number;
  customizations?: string[];
  special_instructions?: string;
}

export interface BuildCartInput {
  restaurant_id: string;
  restaurant_name?: string;
  items: CartItemInput[];
}

export class CartManagementTool {
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

  async buildCart(input: BuildCartInput): Promise<ToolResult> {
    try {
      // Ensure we're ready
      await this.navigation.ensureReady();

      // Navigate to restaurant
      await this.session.goToRestaurant(input.restaurant_id);
      await this.wait(2500);

      // Create cart in state
      await this.state.createCart(
        input.restaurant_id,
        input.restaurant_name || input.restaurant_id
      );

      // Add each item
      const addedItems: CartItem[] = [];
      const errors: string[] = [];

      for (const item of input.items) {
        const result = await this.addItemToCart(item);
        if (result.success && result.data) {
          addedItems.push(result.data as CartItem);
        } else {
          errors.push(result.error || `Failed to add ${item.name}`);
        }
      }

      // Get final cart state
      const cart = this.state.getCart();

      // Format output
      let output = '# Cart Updated\n\n';

      if (addedItems.length > 0) {
        output += '## Items Added\n\n';
        for (const item of addedItems) {
          output += `- ${item.quantity}x ${item.name} - $${(item.price * item.quantity).toFixed(2)}\n`;
          if (item.customizations.length > 0) {
            output += `  Customizations: ${item.customizations.map((c) => c.name).join(', ')}\n`;
          }
          if (item.specialInstructions) {
            output += `  Instructions: ${item.specialInstructions}\n`;
          }
        }
      }

      if (errors.length > 0) {
        output += '\n## Errors\n\n';
        for (const error of errors) {
          output += `- ${error}\n`;
        }
      }

      if (cart) {
        output += `\n## Cart Summary\n`;
        output += `- Subtotal: $${cart.subtotal.toFixed(2)}\n`;
        output += `- Delivery Fee: $${cart.deliveryFee.toFixed(2)}\n`;
        output += `- Service Fee: $${cart.serviceFee.toFixed(2)}\n`;
        output += `- Tax: $${cart.tax.toFixed(2)}\n`;
        output += `- **Total: $${cart.total.toFixed(2)}**\n`;
      }

      return {
        success: addedItems.length > 0,
        data: cart,
        message: output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addItemToCart(item: CartItemInput): Promise<ToolResult> {
    try {
      // Find the item on the page
      const snapshot = await this.browser.snapshot(true);
      const itemRef = this.browser.findRefByText(snapshot, item.name);

      if (!itemRef) {
        return {
          success: false,
          error: `Could not find item: ${item.name}`,
        };
      }

      // Click on the item
      await this.browser.clickRef(itemRef, item.name);
      await this.wait(1500);

      // Set quantity if needed
      const quantity = item.quantity || 1;
      if (quantity > 1) {
        await this.navigation.setQuantity(quantity);
      }

      // Apply customizations
      const appliedCustomizations: Customization[] = [];
      if (item.customizations && item.customizations.length > 0) {
        for (const customization of item.customizations) {
          const applied = await this.navigation.selectCustomization(customization);
          if (applied) {
            appliedCustomizations.push({
              name: customization,
              options: [],
              priceModifier: 0, // Would need to parse from page
            });
          }
        }
      }

      // Add special instructions
      if (item.special_instructions) {
        await this.navigation.addSpecialInstructions(item.special_instructions);
      }

      // Click add to cart
      const addRef = await this.healer.findElement('add_to_cart_button');
      await this.browser.clickRef(addRef, 'Add to cart');
      await this.wait(1000);

      // Extract price from the page/button
      const currentSnapshot = await this.browser.snapshot(true);
      const priceMatch = currentSnapshot.match(/\$(\d+\.?\d*)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

      // Create cart item
      const cartItem: CartItem = {
        id: uuidv4(),
        name: item.name,
        quantity,
        price,
        customizations: appliedCustomizations,
        specialInstructions: item.special_instructions,
      };

      // Add to state
      await this.state.addToCart(cartItem);

      return {
        success: true,
        data: cartItem,
        message: `Added ${quantity}x ${item.name} to cart`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async viewCart(): Promise<ToolResult> {
    const cart = this.state.getCart();

    if (!cart || cart.items.length === 0) {
      return {
        success: true,
        data: null,
        message: 'Your cart is empty.',
      };
    }

    let output = `# Your Cart - ${cart.restaurantName}\n\n`;
    output += `## Items\n\n`;

    for (const item of cart.items) {
      output += `- ${item.quantity}x **${item.name}** - $${(item.price * item.quantity).toFixed(2)}\n`;
      if (item.customizations.length > 0) {
        output += `  Customizations: ${item.customizations.map((c) => c.name).join(', ')}\n`;
      }
      if (item.specialInstructions) {
        output += `  Instructions: ${item.specialInstructions}\n`;
      }
    }

    output += `\n## Summary\n`;
    output += `- Subtotal: $${cart.subtotal.toFixed(2)}\n`;
    output += `- Delivery Fee: $${cart.deliveryFee.toFixed(2)}\n`;
    output += `- Service Fee: $${cart.serviceFee.toFixed(2)}\n`;
    output += `- Tax: $${cart.tax.toFixed(2)}\n`;
    output += `- **Total: $${cart.total.toFixed(2)}**\n`;

    if (cart.deliveryAddress) {
      output += `\nDelivering to: ${cart.deliveryAddress}`;
    }

    return {
      success: true,
      data: cart,
      message: output,
    };
  }

  async clearCart(): Promise<ToolResult> {
    await this.state.clearCart();
    return {
      success: true,
      message: 'Cart cleared.',
    };
  }

  async removeItem(itemId: string): Promise<ToolResult> {
    const cart = await this.state.removeFromCart(itemId);

    if (!cart) {
      return {
        success: false,
        error: 'Item not found in cart',
      };
    }

    return {
      success: true,
      data: cart,
      message: 'Item removed from cart.',
    };
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const buildCartSchema = {
  name: 'build_cart',
  description: 'Add items to cart with customizations',
  inputSchema: {
    type: 'object' as const,
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Restaurant ID',
      },
      restaurant_name: {
        type: 'string',
        description: 'Restaurant name (optional, for display)',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Item name',
            },
            quantity: {
              type: 'number',
              description: 'Quantity (default: 1)',
            },
            customizations: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of customization options to select',
            },
            special_instructions: {
              type: 'string',
              description: 'Special instructions for the item',
            },
          },
          required: ['name'],
        },
        description: 'Items to add to cart',
      },
    },
    required: ['restaurant_id', 'items'],
  },
};

export const viewCartSchema = {
  name: 'view_cart',
  description: 'View current cart contents',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export const clearCartSchema = {
  name: 'clear_cart',
  description: 'Clear all items from cart',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
