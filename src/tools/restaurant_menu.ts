/**
 * Restaurant Menu Tool
 * Get restaurant menu with popular items first
 */

import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { PatternMatcher } from '../patterns/pattern-matcher';
import { ClaudeClient } from '../claude/client';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { ToolResult, MenuItem } from '../state/types';

export interface RestaurantMenuInput {
  restaurant_id?: string;
  restaurant_name?: string;
}

export class RestaurantMenuTool {
  private navigation: NavigationHelper;
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private claude: ClaudeClient;
  private matcher: PatternMatcher;

  constructor(
    navigation: NavigationHelper,
    session: SessionManager,
    browser: ShoppingTravelClient,
    claude: ClaudeClient
  ) {
    this.navigation = navigation;
    this.session = session;
    this.browser = browser;
    this.claude = claude;
    this.matcher = new PatternMatcher(browser);
  }

  async execute(input: RestaurantMenuInput): Promise<ToolResult> {
    try {
      // Ensure we're ready
      await this.navigation.ensureReady();

      // Navigate to restaurant
      if (input.restaurant_id) {
        await this.session.goToRestaurant(input.restaurant_id);
      } else if (input.restaurant_name) {
        // Search for the restaurant
        await this.navigation.searchRestaurants(input.restaurant_name);
        await this.wait(2000);

        // Find and click the restaurant
        const snapshot = await this.browser.snapshot(true);
        const restaurantRef = this.browser.findRefByText(
          snapshot,
          input.restaurant_name,
          'link'
        );

        if (restaurantRef) {
          await this.browser.clickRef(restaurantRef, input.restaurant_name);
        } else {
          return {
            success: false,
            error: `Could not find restaurant: ${input.restaurant_name}`,
          };
        }
      } else {
        return {
          success: false,
          error: 'Must provide either restaurant_id or restaurant_name',
        };
      }

      await this.wait(2500);

      // Get menu
      const snapshot = await this.browser.snapshot(true);
      const pageText = await this.browser.getText();

      // Use Claude to parse menu items
      const menuItems = await this.claude.parseMenuItems(pageText);

      // Also extract from ARIA snapshot for refs
      const elements = this.matcher.parseSnapshot(snapshot);
      const itemsWithRefs = this.matcher.extractMenuItems(elements);

      // Merge refs with parsed items
      const mergedItems = this.mergeMenuData(menuItems, itemsWithRefs);

      // Sort with popular items first
      mergedItems.sort((a, b) => {
        if (a.isPopular && !b.isPopular) return -1;
        if (!a.isPopular && b.isPopular) return 1;
        return 0;
      });

      // Format output
      const output = this.formatOutput(mergedItems, input.restaurant_name || '');

      return {
        success: true,
        data: mergedItems,
        message: output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private mergeMenuData(
    parsedItems: Array<{
      name: string;
      description: string;
      price: number;
      category: string;
      isPopular: boolean;
    }>,
    itemsWithRefs: Array<{
      ref: string;
      name: string;
      price: string;
      description: string;
    }>
  ): Array<MenuItem & { ref?: string }> {
    const result: Array<MenuItem & { ref?: string }> = [];

    for (const parsed of parsedItems) {
      // Find matching ref
      const withRef = itemsWithRefs.find(
        (r) => r.name.toLowerCase().includes(parsed.name.toLowerCase().substring(0, 10))
      );

      result.push({
        id: withRef?.ref || parsed.name.toLowerCase().replace(/\s+/g, '-'),
        name: parsed.name,
        description: parsed.description,
        price: parsed.price,
        category: parsed.category,
        isPopular: parsed.isPopular,
        customizationOptions: [],
        ref: withRef?.ref,
      });
    }

    return result;
  }

  private formatOutput(items: Array<MenuItem & { ref?: string }>, restaurantName: string): string {
    if (items.length === 0) {
      return 'Could not load menu items. The restaurant may be closed or unavailable.';
    }

    let output = `# Menu${restaurantName ? ` - ${restaurantName}` : ''}\n\n`;

    // Group popular items
    const popular = items.filter((i) => i.isPopular);
    const regular = items.filter((i) => !i.isPopular);

    if (popular.length > 0) {
      output += '## ⭐ Popular Items\n\n';
      for (const item of popular) {
        output += this.formatMenuItem(item);
      }
      output += '\n';
    }

    // Group by category
    const byCategory = new Map<string, typeof items>();
    for (const item of regular) {
      const list = byCategory.get(item.category) || [];
      list.push(item);
      byCategory.set(item.category, list);
    }

    for (const [category, categoryItems] of byCategory.entries()) {
      output += `## ${category}\n\n`;
      for (const item of categoryItems) {
        output += this.formatMenuItem(item);
      }
      output += '\n';
    }

    return output;
  }

  private formatMenuItem(item: MenuItem & { ref?: string }): string {
    let line = `- **${item.name}** - $${item.price.toFixed(2)}`;
    if (item.description) {
      line += `\n  ${item.description}`;
    }
    if (item.ref) {
      line += ` *(ref: ${item.ref})*`;
    }
    line += '\n';
    return line;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const restaurantMenuSchema = {
  name: 'get_restaurant_menu',
  description: 'Get restaurant menu with popular items first',
  inputSchema: {
    type: 'object' as const,
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Restaurant ID (from browse_restaurants)',
      },
      restaurant_name: {
        type: 'string',
        description: 'Restaurant name to search for',
      },
    },
  },
};
