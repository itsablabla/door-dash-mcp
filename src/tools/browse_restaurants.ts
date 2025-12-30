/**
 * Browse Restaurants Tool
 * Browse DoorDash restaurants, organized by cuisine
 */

import { NavigationHelper } from '../browser/navigation';
import { SessionManager } from '../browser/session';
import { PatternMatcher } from '../patterns/pattern-matcher';
import { ClaudeClient } from '../claude/client';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import { StateManager } from '../state/manager';
import { ToolResult, Restaurant } from '../state/types';

export interface BrowseRestaurantsInput {
  location?: string;
  cuisine_filter?: string;
}

export class BrowseRestaurantsTool {
  private navigation: NavigationHelper;
  private session: SessionManager;
  private browser: ShoppingTravelClient;
  private claude: ClaudeClient;
  private state: StateManager;
  private matcher: PatternMatcher;

  constructor(
    navigation: NavigationHelper,
    session: SessionManager,
    browser: ShoppingTravelClient,
    claude: ClaudeClient,
    state: StateManager
  ) {
    this.navigation = navigation;
    this.session = session;
    this.browser = browser;
    this.claude = claude;
    this.state = state;
    this.matcher = new PatternMatcher(browser);
  }

  async execute(input: BrowseRestaurantsInput): Promise<ToolResult> {
    try {
      // Ensure we're ready
      await this.navigation.ensureReady();

      // Set location if provided
      if (input.location) {
        const locationSet = await this.navigation.setDeliveryAddress(input.location);
        if (locationSet) {
          await this.state.setDeliveryAddress(input.location);
        }
      }

      // Navigate to home/browse
      await this.session.goToHome();
      await this.wait(2000);

      // If cuisine filter, try to navigate to that category
      if (input.cuisine_filter) {
        await this.navigation.browseByCategory(input.cuisine_filter);
        await this.wait(1500);
      }

      // Get restaurant listings
      const snapshot = await this.browser.snapshot(true);
      const elements = this.matcher.parseSnapshot(snapshot);
      const restaurantElements = this.matcher.extractRestaurantInfo(elements);

      // Get page text for better extraction
      const pageText = await this.browser.getText();

      // Use Claude to categorize if no filter
      let restaurants: Array<{
        name: string;
        cuisine: string;
        details: string;
        ref: string;
      }> = [];

      if (restaurantElements.length > 0) {
        // If we have elements, try to categorize them
        const restaurantNames = restaurantElements.map((r) => ({
          name: r.name,
          description: r.details,
        }));

        const categories = await this.claude.categorizeRestaurants(restaurantNames);

        // Build categorized list
        for (const el of restaurantElements) {
          let cuisine = 'other';

          // Find which category this restaurant belongs to
          for (const [cat, names] of categories.entries()) {
            if (names.some((n) => n.toLowerCase() === el.name.toLowerCase())) {
              cuisine = cat;
              break;
            }
          }

          // Apply filter if specified
          if (input.cuisine_filter && cuisine !== input.cuisine_filter.toLowerCase()) {
            continue;
          }

          restaurants.push({
            name: el.name,
            cuisine,
            details: el.details,
            ref: el.ref,
          });
        }
      }

      // Format output
      const output = this.formatOutput(restaurants, input.cuisine_filter);

      return {
        success: true,
        data: restaurants,
        message: output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private formatOutput(
    restaurants: Array<{ name: string; cuisine: string; details: string; ref: string }>,
    filter?: string
  ): string {
    if (restaurants.length === 0) {
      return filter
        ? `No ${filter} restaurants found in your area.`
        : 'No restaurants found. Try setting a delivery address first.';
    }

    // Group by cuisine
    const byCuisine = new Map<string, typeof restaurants>();
    for (const r of restaurants) {
      const list = byCuisine.get(r.cuisine) || [];
      list.push(r);
      byCuisine.set(r.cuisine, list);
    }

    let output = `# Restaurants${filter ? ` - ${filter}` : ''}\n\n`;

    for (const [cuisine, list] of byCuisine.entries()) {
      output += `## ${cuisine.charAt(0).toUpperCase() + cuisine.slice(1)}\n\n`;

      for (const r of list.slice(0, 10)) {
        // Limit to 10 per category
        output += `- **${r.name}**`;
        if (r.details) {
          output += ` - ${r.details}`;
        }
        output += `\n`;
      }

      output += '\n';
    }

    output += `\nTotal: ${restaurants.length} restaurants found`;

    return output;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const browseRestaurantsSchema = {
  name: 'browse_restaurants',
  description: 'Browse DoorDash restaurants, organized by cuisine',
  inputSchema: {
    type: 'object' as const,
    properties: {
      location: {
        type: 'string',
        description: 'Delivery address (optional - uses saved address if not provided)',
      },
      cuisine_filter: {
        type: 'string',
        description:
          'Filter by cuisine (optional): mexican, italian, chinese, japanese, indian, thai, american, fast_food, pizza, breakfast, healthy, desserts',
      },
    },
  },
};
