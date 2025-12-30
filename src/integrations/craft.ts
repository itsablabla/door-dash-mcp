/**
 * Craft MCP Integration
 * Wrapper for state persistence via Craft documents
 */

import { AppState, PatternLibrary, Session, Cart, Order } from '../state/types';

export interface CraftConfig {
  spaceId: string;
  stateDocId: string;
  patternDocId: string;
  errorLogDocId: string;
}

export class CraftClient {
  private mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  private config: CraftConfig;

  constructor(
    mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    config: CraftConfig
  ) {
    this.mcpCallHandler = mcpCallHandler;
    this.config = config;
  }

  /**
   * Load state from Craft document
   */
  async loadState(): Promise<Partial<AppState>> {
    try {
      const result = await this.mcpCallHandler('blocks_get', {
        id: this.config.stateDocId,
        format: 'markdown',
      });

      const markdown = result as string;
      return this.parseStateMarkdown(markdown);
    } catch (error) {
      console.error('Failed to load state from Craft:', error);
      return {};
    }
  }

  /**
   * Save state to Craft document
   */
  async saveState(state: Partial<AppState>): Promise<void> {
    const markdown = this.formatStateMarkdown(state);

    try {
      // Clear existing content and write new
      await this.mcpCallHandler('markdown_add', {
        markdown,
        position: { pageId: this.config.stateDocId, position: 'replace' },
      });
    } catch (error) {
      console.error('Failed to save state to Craft:', error);
      throw error;
    }
  }

  /**
   * Load pattern library from Craft
   */
  async loadPatterns(): Promise<PatternLibrary | null> {
    try {
      const result = await this.mcpCallHandler('blocks_get', {
        id: this.config.patternDocId,
        format: 'markdown',
      });

      const markdown = result as string;
      const jsonMatch = markdown.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]) as PatternLibrary;
      }
      return null;
    } catch (error) {
      console.error('Failed to load patterns from Craft:', error);
      return null;
    }
  }

  /**
   * Save pattern library to Craft
   */
  async savePatterns(patterns: PatternLibrary): Promise<void> {
    const markdown = `# DoorDash UI Patterns

Last Updated: ${new Date().toISOString()}

\`\`\`json
${JSON.stringify(patterns, null, 2)}
\`\`\`
`;

    try {
      await this.mcpCallHandler('markdown_add', {
        markdown,
        position: { pageId: this.config.patternDocId, position: 'replace' },
      });
    } catch (error) {
      console.error('Failed to save patterns to Craft:', error);
      throw error;
    }
  }

  /**
   * Log error to Craft
   */
  async logError(error: Error, context: string): Promise<void> {
    const markdown = `
## Error: ${new Date().toISOString()}

**Context:** ${context}

**Error:** ${error.message}

**Stack:**
\`\`\`
${error.stack}
\`\`\`

---
`;

    try {
      await this.mcpCallHandler('markdown_add', {
        markdown,
        position: { pageId: this.config.errorLogDocId, position: 'end' },
      });
    } catch (logError) {
      console.error('Failed to log error to Craft:', logError);
    }
  }

  /**
   * Log healing event to Craft
   */
  async logHealingEvent(
    patternKey: string,
    change: string,
    success: boolean
  ): Promise<void> {
    const markdown = `
## Healing Event: ${new Date().toISOString()}

**Pattern:** ${patternKey}
**Change:** ${change}
**Success:** ${success ? '✅' : '❌'}

---
`;

    try {
      await this.mcpCallHandler('markdown_add', {
        markdown,
        position: { pageId: this.config.stateDocId, position: 'end' },
      });
    } catch (error) {
      console.error('Failed to log healing event:', error);
    }
  }

  /**
   * Save session cookies
   */
  async saveSession(session: Session): Promise<void> {
    const markdown = `
## DoorDash Session

**Email:** ${session.email}
**Authenticated:** ${session.authenticated}
**Last Active:** ${session.lastActive}

### Cookies
\`\`\`
${session.cookies}
\`\`\`
`;

    try {
      await this.mcpCallHandler('markdown_add', {
        markdown,
        position: { pageId: this.config.stateDocId, position: 'start' },
      });
    } catch (error) {
      console.error('Failed to save session to Craft:', error);
      throw error;
    }
  }

  private parseStateMarkdown(markdown: string): Partial<AppState> {
    const state: Partial<AppState> = {};

    // Parse session
    const sessionMatch = markdown.match(/## DoorDash Session[\s\S]*?(?=##|$)/);
    if (sessionMatch) {
      const emailMatch = sessionMatch[0].match(/\*\*Email:\*\* (.+)/);
      const authMatch = sessionMatch[0].match(/\*\*Authenticated:\*\* (.+)/);
      const lastActiveMatch = sessionMatch[0].match(/\*\*Last Active:\*\* (.+)/);
      const cookiesMatch = sessionMatch[0].match(/```\n([\s\S]*?)\n```/);

      if (emailMatch || authMatch) {
        state.session = {
          email: emailMatch?.[1] || '',
          authenticated: authMatch?.[1] === 'true',
          lastActive: lastActiveMatch?.[1] || '',
          cookies: cookiesMatch?.[1] || '',
        };
      }
    }

    // Parse cart
    const cartMatch = markdown.match(/## Current Cart[\s\S]*?```json\n([\s\S]*?)\n```/);
    if (cartMatch) {
      try {
        state.cart = JSON.parse(cartMatch[1]) as Cart;
      } catch {
        // Cart not parseable
      }
    }

    // Parse active order
    const orderMatch = markdown.match(/## Active Order[\s\S]*?```json\n([\s\S]*?)\n```/);
    if (orderMatch) {
      try {
        state.activeOrder = JSON.parse(orderMatch[1]) as Order;
      } catch {
        // Order not parseable
      }
    }

    // Parse delivery address
    const addressMatch = markdown.match(/\*\*Delivery Address:\*\* (.+)/);
    if (addressMatch) {
      state.deliveryAddress = addressMatch[1];
    }

    return state;
  }

  private formatStateMarkdown(state: Partial<AppState>): string {
    let markdown = `# DoorDash MCP State

Last Updated: ${new Date().toISOString()}

`;

    if (state.session) {
      markdown += `## DoorDash Session

**Email:** ${state.session.email}
**Authenticated:** ${state.session.authenticated}
**Last Active:** ${state.session.lastActive}

### Cookies
\`\`\`
${state.session.cookies}
\`\`\`

`;
    }

    if (state.deliveryAddress) {
      markdown += `**Delivery Address:** ${state.deliveryAddress}

`;
    }

    if (state.cart) {
      markdown += `## Current Cart

\`\`\`json
${JSON.stringify(state.cart, null, 2)}
\`\`\`

`;
    }

    if (state.activeOrder) {
      markdown += `## Active Order

\`\`\`json
${JSON.stringify(state.activeOrder, null, 2)}
\`\`\`

`;
    }

    return markdown;
  }
}
