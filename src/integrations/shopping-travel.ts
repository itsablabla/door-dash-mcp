/**
 * Shopping & Travel MCP Integration
 * Wrapper for browser automation tools available via Shopping & Travel MCP
 */

import { SnapshotElement } from '../state/types';

export interface ShoppingTravelConfig {
  // MCP tools are available via the parent orchestrator
  // This client provides a typed wrapper
}

export class ShoppingTravelClient {
  private mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>;

  constructor(mcpCallHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
    this.mcpCallHandler = mcpCallHandler;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<{ success: boolean; url: string }> {
    const result = await this.mcpCallHandler('scraping_browser_navigate', { url });
    return result as { success: boolean; url: string };
  }

  /**
   * Get ARIA snapshot of current page
   * @param filtered - If true, returns filtered snapshot with key elements only
   */
  async snapshot(filtered: boolean = true): Promise<string> {
    const result = await this.mcpCallHandler('scraping_browser_snapshot', { filtered });
    return result as string;
  }

  /**
   * Click an element by ref
   * @param ref - The element ref from ARIA snapshot
   * @param element - Human-readable description of element
   */
  async clickRef(ref: string, element: string): Promise<{ success: boolean }> {
    const result = await this.mcpCallHandler('scraping_browser_click_ref', { ref, element });
    return result as { success: boolean };
  }

  /**
   * Type text into an element
   * @param ref - The element ref from ARIA snapshot
   * @param element - Human-readable description of element
   * @param text - Text to type
   * @param submit - If true, press Enter after typing
   */
  async typeRef(
    ref: string,
    element: string,
    text: string,
    submit: boolean = false
  ): Promise<{ success: boolean }> {
    const result = await this.mcpCallHandler('scraping_browser_type_ref', {
      ref,
      element,
      text,
      submit,
    });
    return result as { success: boolean };
  }

  /**
   * Scroll to an element
   */
  async scrollToRef(ref: string, element: string): Promise<{ success: boolean }> {
    const result = await this.mcpCallHandler('scraping_browser_scroll_to_ref', { ref, element });
    return result as { success: boolean };
  }

  /**
   * Wait for an element to appear
   * @param timeout - Timeout in milliseconds
   */
  async waitForRef(ref: string, element: string, timeout: number = 10000): Promise<{ success: boolean }> {
    const result = await this.mcpCallHandler('scraping_browser_wait_for_ref', {
      ref,
      element,
      timeout,
    });
    return result as { success: boolean };
  }

  /**
   * Take a screenshot
   * @param fullPage - If true, captures full page scroll
   */
  async screenshot(fullPage: boolean = false): Promise<string> {
    const result = await this.mcpCallHandler('scraping_browser_screenshot', { full_page: fullPage });
    return result as string; // Base64 encoded image
  }

  /**
   * Get raw HTML of page
   */
  async getHtml(fullPage: boolean = false): Promise<string> {
    const result = await this.mcpCallHandler('scraping_browser_get_html', { full_page: fullPage });
    return result as string;
  }

  /**
   * Get text content of page
   */
  async getText(): Promise<string> {
    const result = await this.mcpCallHandler('scraping_browser_get_text', {});
    return result as string;
  }

  /**
   * Parse ARIA snapshot to find elements
   */
  parseSnapshot(snapshot: string): SnapshotElement[] {
    const elements: SnapshotElement[] = [];
    const lines = snapshot.split('\n');

    for (const line of lines) {
      // Parse ARIA snapshot format: [ref] role "name" text
      const match = line.match(/\[(\w+)\]\s*(\w+)?\s*"?([^"]*)"?\s*(.*)?/);
      if (match) {
        elements.push({
          ref: match[1],
          role: match[2] || undefined,
          name: match[3] || undefined,
          text: match[4]?.trim() || undefined,
        });
      }
    }

    return elements;
  }

  /**
   * Find element ref by text content
   */
  findRefByText(snapshot: string, text: string, role?: string): string | null {
    const elements = this.parseSnapshot(snapshot);

    for (const el of elements) {
      const textMatch =
        el.name?.toLowerCase().includes(text.toLowerCase()) ||
        el.text?.toLowerCase().includes(text.toLowerCase());

      const roleMatch = !role || el.role === role;

      if (textMatch && roleMatch) {
        return el.ref;
      }
    }

    return null;
  }

  /**
   * Find all elements matching criteria
   */
  findAllRefs(
    snapshot: string,
    criteria: { text?: string; role?: string; nameContains?: string }
  ): SnapshotElement[] {
    const elements = this.parseSnapshot(snapshot);
    const matches: SnapshotElement[] = [];

    for (const el of elements) {
      let match = true;

      if (criteria.text && !(el.text?.toLowerCase().includes(criteria.text.toLowerCase()))) {
        match = false;
      }

      if (criteria.role && el.role !== criteria.role) {
        match = false;
      }

      if (criteria.nameContains && !(el.name?.toLowerCase().includes(criteria.nameContains.toLowerCase()))) {
        match = false;
      }

      if (match) {
        matches.push(el);
      }
    }

    return matches;
  }
}
