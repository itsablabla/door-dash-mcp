/**
 * Pattern Healer
 * Self-healing logic for UI patterns using Claude API
 */

import { ClaudeClient } from '../claude/client';
import { CraftClient } from '../integrations/craft';
import { BeeperClient } from '../integrations/beeper';
import { ShoppingTravelClient } from '../integrations/shopping-travel';
import {
  PatternLibrary,
  UIPattern,
  PatternStrategy,
  HealingEvent,
  PatternHealingError,
} from '../state/types';
import { PatternMatcher } from './pattern-matcher';
import defaultPatterns from './ui-patterns.json';

const MAX_HEALING_ATTEMPTS_PER_HOUR = 3;
const HEALING_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface HealingAttempt {
  patternKey: string;
  timestamp: number;
}

export class PatternHealer {
  private patterns: PatternLibrary;
  private matcher: PatternMatcher;
  private claude: ClaudeClient;
  private craft: CraftClient;
  private beeper: BeeperClient;
  private browser: ShoppingTravelClient;
  private healingAttempts: HealingAttempt[] = [];

  constructor(
    browser: ShoppingTravelClient,
    claude: ClaudeClient,
    craft: CraftClient,
    beeper: BeeperClient
  ) {
    this.browser = browser;
    this.claude = claude;
    this.craft = craft;
    this.beeper = beeper;
    this.patterns = defaultPatterns as PatternLibrary;
    this.matcher = new PatternMatcher(browser);
  }

  /**
   * Initialize patterns from Craft or use defaults
   */
  async initialize(): Promise<void> {
    const savedPatterns = await this.craft.loadPatterns();
    if (savedPatterns) {
      this.patterns = savedPatterns;
      console.log('Loaded patterns from Craft');
    } else {
      console.log('Using default patterns');
      await this.savePatterns();
    }
  }

  /**
   * Find element with automatic healing if needed
   */
  async findElement(patternKey: string): Promise<string> {
    const pattern = this.patterns.patterns[patternKey];
    if (!pattern) {
      throw new PatternHealingError(`Unknown pattern: ${patternKey}`);
    }

    // Try to find element with existing patterns
    const snapshot = await this.browser.snapshot(true);
    const result = await this.matcher.findElement(pattern, snapshot);

    if (result) {
      return result.ref;
    }

    // All strategies failed - attempt healing
    console.log(`Pattern ${patternKey} failed, attempting to heal...`);
    return await this.healPattern(patternKey, pattern, snapshot);
  }

  /**
   * Heal a broken pattern using Claude API
   */
  async healPattern(
    patternKey: string,
    pattern: UIPattern,
    snapshot: string
  ): Promise<string> {
    // Check rate limiting
    if (!this.canAttemptHealing(patternKey)) {
      throw new PatternHealingError(
        `Healing rate limit exceeded for pattern ${patternKey}. Please wait before trying again.`
      );
    }

    this.recordHealingAttempt(patternKey);

    try {
      // Capture screenshot for analysis
      const screenshot = await this.browser.screenshot(false);

      // Ask Claude to analyze and find the element
      const analysis = await this.claude.analyzeForHealing(pattern, snapshot, screenshot);

      if (!analysis || analysis.confidence < 50) {
        await this.craft.logHealingEvent(patternKey, 'Claude could not identify element', false);
        throw new PatternHealingError(
          `Could not heal pattern ${patternKey}: Claude analysis failed or low confidence`
        );
      }

      // Create new strategy from Claude's analysis
      const newStrategy: PatternStrategy = {
        ...analysis.newStrategy,
        priority: 0, // Make it highest priority
      };

      // Create healing event record
      const healingEvent: HealingEvent = {
        date: new Date().toISOString(),
        change: analysis.explanation,
        oldStrategy: pattern.strategies[0],
        newStrategy,
        success: true,
      };

      // Update pattern
      pattern.strategies.unshift(newStrategy);
      pattern.healingHistory.push(healingEvent);
      pattern.version++;
      pattern.lastUpdated = new Date().toISOString();

      // Save updated patterns
      await this.savePatterns();

      // Log healing event
      await this.craft.logHealingEvent(patternKey, analysis.explanation, true);

      // Notify via Beeper (for debugging/monitoring)
      await this.beeper.notifyPatternHealed(patternKey, analysis.explanation);

      console.log(`Successfully healed pattern ${patternKey}: ${analysis.explanation}`);

      return analysis.ref;
    } catch (error) {
      // Log failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.craft.logHealingEvent(patternKey, `Failed: ${errorMessage}`, false);

      throw new PatternHealingError(`Healing failed for ${patternKey}: ${errorMessage}`);
    }
  }

  /**
   * Get pattern by key
   */
  getPattern(patternKey: string): UIPattern | null {
    return this.patterns.patterns[patternKey] || null;
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): PatternLibrary {
    return this.patterns;
  }

  /**
   * Save patterns to Craft
   */
  async savePatterns(): Promise<void> {
    this.patterns.lastUpdated = new Date().toISOString();
    await this.craft.savePatterns(this.patterns);
  }

  /**
   * Check if we can attempt healing (rate limiting)
   */
  private canAttemptHealing(patternKey: string): boolean {
    const now = Date.now();

    // Clean up old attempts
    this.healingAttempts = this.healingAttempts.filter(
      (a) => now - a.timestamp < HEALING_COOLDOWN_MS
    );

    // Count recent attempts for this pattern
    const recentAttempts = this.healingAttempts.filter(
      (a) => a.patternKey === patternKey && now - a.timestamp < HEALING_COOLDOWN_MS
    );

    return recentAttempts.length < MAX_HEALING_ATTEMPTS_PER_HOUR;
  }

  /**
   * Record a healing attempt for rate limiting
   */
  private recordHealingAttempt(patternKey: string): void {
    this.healingAttempts.push({
      patternKey,
      timestamp: Date.now(),
    });
  }

  /**
   * Manually add or update a pattern
   */
  async updatePattern(patternKey: string, pattern: Partial<UIPattern>): Promise<void> {
    const existing = this.patterns.patterns[patternKey];

    if (existing) {
      this.patterns.patterns[patternKey] = {
        ...existing,
        ...pattern,
        version: existing.version + 1,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      this.patterns.patterns[patternKey] = {
        description: pattern.description || patternKey,
        version: 1,
        lastUpdated: new Date().toISOString(),
        strategies: pattern.strategies || [],
        healingHistory: [],
      };
    }

    await this.savePatterns();
  }

  /**
   * Get healing statistics
   */
  getHealingStats(): {
    totalPatterns: number;
    totalHeals: number;
    recentHeals: number;
    patternsNeedingAttention: string[];
  } {
    const patterns = Object.entries(this.patterns.patterns);
    let totalHeals = 0;
    let recentHeals = 0;
    const patternsNeedingAttention: string[] = [];

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    for (const [key, pattern] of patterns) {
      totalHeals += pattern.healingHistory.length;

      // Count recent heals
      const recentPatternHeals = pattern.healingHistory.filter(
        (h) => new Date(h.date) > oneWeekAgo
      ).length;
      recentHeals += recentPatternHeals;

      // Flag patterns that heal frequently
      if (recentPatternHeals >= 2) {
        patternsNeedingAttention.push(key);
      }
    }

    return {
      totalPatterns: patterns.length,
      totalHeals,
      recentHeals,
      patternsNeedingAttention,
    };
  }
}
