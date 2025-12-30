/**
 * DoorDash MCP Server
 * Self-healing browser automation for GARZA OS
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import integrations
import { ShoppingTravelClient } from './integrations/shopping-travel';
import { BeeperClient } from './integrations/beeper';
import { CraftClient } from './integrations/craft';
import { ClaudeClient } from './claude/client';

// Import browser management
import { SessionManager } from './browser/session';
import { AuthManager } from './browser/auth';
import { NavigationHelper } from './browser/navigation';

// Import pattern system
import { PatternHealer } from './patterns/pattern-healer';

// Import state management
import { StateManager } from './state/manager';

// Import tools
import { BrowseRestaurantsTool, browseRestaurantsSchema } from './tools/browse_restaurants';
import { RecentOrdersTool, recentOrdersSchema, reorderSchema } from './tools/recent_orders';
import { RestaurantMenuTool, restaurantMenuSchema } from './tools/restaurant_menu';
import {
  CartManagementTool,
  buildCartSchema,
  viewCartSchema,
  clearCartSchema,
} from './tools/cart_management';
import { OrderPlacementTool, reviewOrderSchema, placeOrderSchema } from './tools/order_placement';
import { OrderTrackingTool, trackOrderSchema, stopTrackingSchema } from './tools/order_tracking';
import { SetLocationTool, setLocationSchema } from './tools/set_location';

// Configuration from environment
const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  doordashEmail: process.env.DOORDASH_EMAIL || '',
  doordashPassword: process.env.DOORDASH_PASSWORD || '',
  beeperChatId: process.env.BEEPER_CHAT_ID || '',
  craftSpaceId: process.env.CRAFT_SPACE_ID || '',
  craftApiKey: process.env.CRAFT_API_KEY || '',
  craftStateDocId: process.env.CRAFT_STATE_DOC_ID || '',
  craftPatternDocId: process.env.CRAFT_PATTERN_DOC_ID || '',
  craftErrorLogDocId: process.env.CRAFT_ERROR_LOG_DOC_ID || '',
  port: parseInt(process.env.PORT || '3000', 10),
};

// MCP tool call handler - this will be set up to communicate with parent MCPs
// In production, this connects to Shopping & Travel MCP, Beeper MCP, and Craft MCP
let mcpToolHandler: (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Create MCP tool handler
 * This simulates calling tools from other MCPs in the GARZA OS ecosystem
 */
function createMCPHandler(): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    // In production, this would make actual MCP calls to:
    // - Shopping & Travel MCP (scraping_browser_* tools)
    // - Beeper MCP (send_message)
    // - Craft MCP (blocks_get, markdown_add, etc.)

    console.log(`MCP Tool Call: ${name}`, JSON.stringify(args, null, 2));

    // For now, return mock responses for development
    // In production, this integrates with the actual MCP orchestrator

    switch (name) {
      case 'scraping_browser_navigate':
        return { success: true, url: args.url };

      case 'scraping_browser_snapshot':
        return `[e1] link "DoorDash"
[e2] textbox "Search"
[e3] link "Account"`;

      case 'scraping_browser_click_ref':
        return { success: true };

      case 'scraping_browser_type_ref':
        return { success: true };

      case 'scraping_browser_screenshot':
        return ''; // Base64 screenshot

      case 'scraping_browser_get_text':
        return 'Page text content';

      case 'send_message':
        console.log(`[Beeper] Sending message to ${args.chatID}:`, args.text);
        return { success: true };

      case 'blocks_get':
        return '# State\n\nEmpty state';

      case 'markdown_add':
        console.log(`[Craft] Saving to ${args.position}:`, args.markdown);
        return { success: true };

      default:
        throw new Error(`Unknown MCP tool: ${name}`);
    }
  };
}

/**
 * Initialize all services
 */
async function initializeServices() {
  mcpToolHandler = createMCPHandler();

  // Initialize integration clients
  const browser = new ShoppingTravelClient(mcpToolHandler);
  const beeper = new BeeperClient(mcpToolHandler, { chatId: config.beeperChatId });
  const craft = new CraftClient(mcpToolHandler, {
    spaceId: config.craftSpaceId,
    stateDocId: config.craftStateDocId,
    patternDocId: config.craftPatternDocId,
    errorLogDocId: config.craftErrorLogDocId,
  });
  const claude = new ClaudeClient({ apiKey: config.anthropicApiKey });

  // Initialize state manager
  const state = new StateManager(craft, beeper);
  await state.initialize();

  // Initialize pattern healer
  const healer = new PatternHealer(browser, claude, craft, beeper);
  await healer.initialize();

  // Initialize session management
  const session = new SessionManager(browser, craft, healer);
  await session.initialize();

  // Initialize auth manager
  const auth = new AuthManager(session, browser, healer, craft, {
    email: config.doordashEmail,
    password: config.doordashPassword,
  });

  // Initialize navigation helper
  const navigation = new NavigationHelper(session, auth, healer, browser);

  // Initialize tools
  const tools = {
    browseRestaurants: new BrowseRestaurantsTool(navigation, session, browser, claude, state),
    recentOrders: new RecentOrdersTool(navigation, session, browser, healer, state),
    restaurantMenu: new RestaurantMenuTool(navigation, session, browser, claude),
    cartManagement: new CartManagementTool(navigation, session, browser, healer, state),
    orderPlacement: new OrderPlacementTool(navigation, session, browser, healer, state, craft),
    orderTracking: new OrderTrackingTool(navigation, session, browser, beeper, claude, state),
    setLocation: new SetLocationTool(navigation, state),
  };

  return {
    browser,
    beeper,
    craft,
    claude,
    state,
    healer,
    session,
    auth,
    navigation,
    tools,
  };
}

/**
 * Create and start the MCP server
 */
async function main() {
  console.log('Starting DoorDash MCP Server...');

  // Initialize services
  const services = await initializeServices();

  // Create MCP server
  const server = new Server(
    {
      name: 'doordash-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        browseRestaurantsSchema,
        recentOrdersSchema,
        reorderSchema,
        restaurantMenuSchema,
        buildCartSchema,
        viewCartSchema,
        clearCartSchema,
        reviewOrderSchema,
        placeOrderSchema,
        trackOrderSchema,
        stopTrackingSchema,
        setLocationSchema,
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'browse_restaurants':
          result = await services.tools.browseRestaurants.execute(args as any);
          break;

        case 'get_recent_orders':
          result = await services.tools.recentOrders.execute(args as any);
          break;

        case 'reorder':
          result = await services.tools.recentOrders.reorder((args as any).order_id);
          break;

        case 'get_restaurant_menu':
          result = await services.tools.restaurantMenu.execute(args as any);
          break;

        case 'build_cart':
          result = await services.tools.cartManagement.buildCart(args as any);
          break;

        case 'view_cart':
          result = await services.tools.cartManagement.viewCart();
          break;

        case 'clear_cart':
          result = await services.tools.cartManagement.clearCart();
          break;

        case 'review_order':
          result = await services.tools.orderPlacement.reviewOrder();
          break;

        case 'place_order':
          result = await services.tools.orderPlacement.placeOrder(args as any);
          break;

        case 'track_order':
          result = await services.tools.orderTracking.trackOrder();
          break;

        case 'stop_tracking':
          result = await services.tools.orderTracking.stopTracking();
          break;

        case 'set_location':
          result = await services.tools.setLocation.execute(args as any);
          break;

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: result.message || JSON.stringify(result.data, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log error to Craft
      if (services.craft) {
        await services.craft.logError(
          error instanceof Error ? error : new Error(errorMessage),
          `Tool: ${name}`
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server using stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log('DoorDash MCP Server running');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await services.state.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await services.state.cleanup();
    process.exit(0);
  });
}

// Start the server
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
