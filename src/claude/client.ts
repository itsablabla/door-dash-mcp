/**
 * Claude API Client
 * Used for self-healing pattern detection and UI analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import { PatternStrategy, UIPattern } from '../state/types';

export interface ClaudeConfig {
  apiKey: string;
}

export interface HealingAnalysis {
  ref: string;
  explanation: string;
  newStrategy: PatternStrategy;
  confidence: number;
}

export class ClaudeClient {
  private client: Anthropic;

  constructor(config: ClaudeConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  /**
   * Analyze UI to find a pattern that changed
   */
  async analyzeForHealing(
    pattern: UIPattern,
    snapshot: string,
    screenshot: string
  ): Promise<HealingAnalysis | null> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are analyzing a DoorDash web page to find a UI element that has changed.

## Task
${pattern.description}

## Old Pattern That Used to Work
${JSON.stringify(pattern.strategies[0], null, 2)}

## Current ARIA Snapshot
${snapshot}

## Instructions
Find the element that now performs this action and return a JSON object with:
1. "ref": The ref number from the ARIA snapshot (e.g., "e42")
2. "explanation": A brief description of what changed
3. "newStrategy": A new strategy object to find this element reliably
4. "confidence": A number 0-100 indicating your confidence

The newStrategy should have this format:
{
  "type": "aria_role" | "aria_ref" | "text_contains",
  "priority": 1,
  "role": "button" (optional),
  "textContains": "Add to Order" (optional),
  "ref": "e42" (optional),
  "context": "description of where this is" (optional)
}

Return ONLY the JSON object, no other text.`,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshot,
                },
              },
            ],
          },
        ],
      });

      // Parse Claude's response
      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as HealingAnalysis;
        }
      }

      return null;
    } catch (error) {
      console.error('Claude analysis failed:', error);
      return null;
    }
  }

  /**
   * Categorize restaurants by cuisine using Claude
   */
  async categorizeRestaurants(
    restaurants: Array<{ name: string; description?: string }>
  ): Promise<Map<string, string[]>> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `Categorize these restaurants by cuisine type. Return a JSON object where keys are cuisine types (lowercase) and values are arrays of restaurant names.

Restaurants:
${restaurants.map(r => `- ${r.name}${r.description ? `: ${r.description}` : ''}`).join('\n')}

Use these cuisine categories:
- mexican
- italian
- chinese
- japanese
- indian
- thai
- american
- fast_food
- pizza
- breakfast
- healthy
- desserts
- other

Return ONLY the JSON object.`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, string[]>;
          return new Map(Object.entries(parsed));
        }
      }

      return new Map();
    } catch (error) {
      console.error('Restaurant categorization failed:', error);
      return new Map();
    }
  }

  /**
   * Parse menu items from page content
   */
  async parseMenuItems(pageText: string): Promise<Array<{
    name: string;
    description: string;
    price: number;
    category: string;
    isPopular: boolean;
  }>> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: `Parse the menu items from this restaurant page. Return a JSON array of items.

Page Content:
${pageText.substring(0, 10000)}

For each item, extract:
- name: string
- description: string (short description or ingredients)
- price: number (just the number, no $ symbol)
- category: string (the menu section)
- isPopular: boolean (true if marked as popular, most ordered, etc.)

Return ONLY the JSON array of menu items.`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }

      return [];
    } catch (error) {
      console.error('Menu parsing failed:', error);
      return [];
    }
  }

  /**
   * Analyze order status from page content
   */
  async parseOrderStatus(
    pageText: string,
    screenshot?: string
  ): Promise<{
    status: string;
    eta: string | null;
    driver: { name: string; vehicle?: string } | null;
  }> {
    try {
      const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [
        {
          type: 'text',
          text: `Parse the order tracking information from this DoorDash page.

Page Content:
${pageText.substring(0, 5000)}

Return a JSON object with:
- status: one of "pending", "confirmed", "preparing", "ready_for_pickup", "picked_up", "on_the_way", "delivered", "cancelled"
- eta: estimated delivery time as a string, or null
- driver: { name: string, vehicle?: string } or null if no driver assigned

Return ONLY the JSON object.`,
        },
      ];

      if (screenshot) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshot,
          },
        });
      }

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: content as any }],
      });

      const responseContent = response.content[0];
      if (responseContent.type === 'text') {
        const jsonMatch = responseContent.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }

      return { status: 'pending', eta: null, driver: null };
    } catch (error) {
      console.error('Order status parsing failed:', error);
      return { status: 'pending', eta: null, driver: null };
    }
  }
}
