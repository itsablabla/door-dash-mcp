/**
 * Pattern Matcher
 * Finds UI elements using pattern strategies
 */

import { PatternStrategy, SnapshotElement, UIPattern } from '../state/types';
import { ShoppingTravelClient } from '../integrations/shopping-travel';

export class PatternMatcher {
  private browser: ShoppingTravelClient;

  constructor(browser: ShoppingTravelClient) {
    this.browser = browser;
  }

  /**
   * Find element ref using pattern strategies
   */
  async findElement(
    pattern: UIPattern,
    snapshot?: string
  ): Promise<{ ref: string; strategyUsed: PatternStrategy } | null> {
    // Get snapshot if not provided
    const currentSnapshot = snapshot || (await this.browser.snapshot(true));

    // Try each strategy in priority order
    const sortedStrategies = [...pattern.strategies].sort((a, b) => a.priority - b.priority);

    for (const strategy of sortedStrategies) {
      const ref = this.matchStrategy(strategy, currentSnapshot);
      if (ref) {
        return { ref, strategyUsed: strategy };
      }
    }

    return null;
  }

  /**
   * Match a single strategy against snapshot
   */
  matchStrategy(strategy: PatternStrategy, snapshot: string): string | null {
    const elements = this.parseSnapshot(snapshot);

    switch (strategy.type) {
      case 'aria_role':
        return this.matchByRole(elements, strategy);

      case 'aria_ref':
        return this.matchByRef(elements, strategy);

      case 'text_contains':
        return this.matchByText(elements, strategy);

      case 'css_selector':
        // CSS selectors require special handling - we'll fall back to text matching
        // since we only have ARIA snapshot
        if (strategy.textContains) {
          return this.matchByText(elements, strategy);
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Match by ARIA role and optional text
   */
  private matchByRole(elements: SnapshotElement[], strategy: PatternStrategy): string | null {
    for (const el of elements) {
      // Check role matches
      if (strategy.role && el.role !== strategy.role) {
        continue;
      }

      // Check text contains (case insensitive)
      if (strategy.textContains) {
        const textToSearch = `${el.name || ''} ${el.text || ''}`.toLowerCase();
        if (!textToSearch.includes(strategy.textContains.toLowerCase())) {
          continue;
        }
      }

      return el.ref;
    }

    return null;
  }

  /**
   * Match by exact ref
   */
  private matchByRef(elements: SnapshotElement[], strategy: PatternStrategy): string | null {
    if (!strategy.ref) return null;

    for (const el of elements) {
      if (el.ref === strategy.ref) {
        return el.ref;
      }
    }

    return null;
  }

  /**
   * Match by text content
   */
  private matchByText(elements: SnapshotElement[], strategy: PatternStrategy): string | null {
    if (!strategy.textContains) return null;

    const searchText = strategy.textContains.toLowerCase();

    for (const el of elements) {
      const textToSearch = `${el.name || ''} ${el.text || ''}`.toLowerCase();
      if (textToSearch.includes(searchText)) {
        // Optionally check role if specified
        if (strategy.role && el.role !== strategy.role) {
          continue;
        }
        return el.ref;
      }
    }

    return null;
  }

  /**
   * Parse ARIA snapshot into structured elements
   */
  parseSnapshot(snapshot: string): SnapshotElement[] {
    const elements: SnapshotElement[] = [];
    const lines = snapshot.split('\n');

    for (const line of lines) {
      // Handle various ARIA snapshot formats
      // Format 1: [ref] role "name" additional text
      // Format 2: [ref] "text"
      // Format 3: [ref] role: name

      // Try format with brackets
      let match = line.match(/\[([^\]]+)\]\s*(\w+)?\s*"?([^"]*)"?\s*(.*)?/);

      if (!match) {
        // Try format with colon
        match = line.match(/\[([^\]]+)\]\s*(\w+):\s*(.*)/);
      }

      if (match) {
        const element: SnapshotElement = {
          ref: match[1].trim(),
        };

        if (match[2]) {
          element.role = match[2].trim();
        }

        if (match[3]) {
          element.name = match[3].trim();
        }

        if (match[4]) {
          element.text = match[4].trim();
        }

        elements.push(element);
      }
    }

    return elements;
  }

  /**
   * Find all elements matching criteria
   */
  findAllMatching(
    snapshot: string,
    criteria: {
      role?: string;
      textContains?: string;
      nameContains?: string;
    }
  ): SnapshotElement[] {
    const elements = this.parseSnapshot(snapshot);
    const matches: SnapshotElement[] = [];

    for (const el of elements) {
      let isMatch = true;

      if (criteria.role && el.role !== criteria.role) {
        isMatch = false;
      }

      if (criteria.textContains) {
        const text = `${el.name || ''} ${el.text || ''}`.toLowerCase();
        if (!text.includes(criteria.textContains.toLowerCase())) {
          isMatch = false;
        }
      }

      if (criteria.nameContains) {
        if (!el.name?.toLowerCase().includes(criteria.nameContains.toLowerCase())) {
          isMatch = false;
        }
      }

      if (isMatch) {
        matches.push(el);
      }
    }

    return matches;
  }

  /**
   * Extract restaurant info from snapshot elements
   */
  extractRestaurantInfo(elements: SnapshotElement[]): Array<{
    ref: string;
    name: string;
    details: string;
  }> {
    const restaurants: Array<{ ref: string; name: string; details: string }> = [];

    // Look for link elements that appear to be restaurants
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      if (el.role === 'link' && el.name) {
        // Check if it looks like a restaurant name
        // Usually followed by rating, time, price info
        const name = el.name;
        let details = '';

        // Look at next few elements for details
        for (let j = i + 1; j < Math.min(i + 5, elements.length); j++) {
          const nextEl = elements[j];
          if (nextEl.text) {
            details += ` ${nextEl.text}`;
          }
          if (nextEl.name) {
            details += ` ${nextEl.name}`;
          }
        }

        restaurants.push({
          ref: el.ref,
          name,
          details: details.trim(),
        });
      }
    }

    return restaurants;
  }

  /**
   * Extract menu items from snapshot
   */
  extractMenuItems(elements: SnapshotElement[]): Array<{
    ref: string;
    name: string;
    price: string;
    description: string;
  }> {
    const items: Array<{ ref: string; name: string; price: string; description: string }> = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      // Look for button elements that might be menu items
      if (el.role === 'button' && el.name) {
        let price = '';
        let description = '';

        // Look for price in nearby elements
        for (let j = i; j < Math.min(i + 3, elements.length); j++) {
          const nextEl = elements[j];
          const text = `${nextEl.name || ''} ${nextEl.text || ''}`;

          // Check for price pattern
          const priceMatch = text.match(/\$[\d.]+/);
          if (priceMatch) {
            price = priceMatch[0];
          }

          // Accumulate description
          if (nextEl.text && !nextEl.text.match(/\$[\d.]+/)) {
            description += ` ${nextEl.text}`;
          }
        }

        if (el.name.length > 2) {
          // Filter out very short names
          items.push({
            ref: el.ref,
            name: el.name,
            price,
            description: description.trim(),
          });
        }
      }
    }

    return items;
  }
}
