# DoorDash MCP Server

A self-healing browser automation MCP server for DoorDash ordering, built for **GARZA OS** - Jaden's unified AI intelligence infrastructure.

## Features

- **Browse Restaurants** - Organized by cuisine, filterable
- **Recent Orders** - View history and reorder with one click
- **Restaurant Menus** - Popular items prioritized
- **Cart Management** - Add items with customizations
- **Order Placement** - Explicit confirmation required
- **Order Tracking** - Real-time updates with Beeper notifications
- **Self-Healing UI Patterns** - Automatically adapts when DoorDash changes their UI

## Architecture

```
doordash-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/                # MCP tool implementations
│   │   ├── browse_restaurants.ts
│   │   ├── recent_orders.ts
│   │   ├── restaurant_menu.ts
│   │   ├── cart_management.ts
│   │   ├── order_placement.ts
│   │   ├── order_tracking.ts
│   │   └── set_location.ts
│   ├── browser/              # Browser automation
│   │   ├── session.ts        # Session management
│   │   ├── auth.ts           # Authentication
│   │   └── navigation.ts     # Smart navigation
│   ├── patterns/             # Self-healing pattern system
│   │   ├── ui-patterns.json  # Pattern definitions
│   │   ├── pattern-matcher.ts
│   │   └── pattern-healer.ts # Claude-powered healing
│   ├── state/                # State management
│   │   ├── manager.ts
│   │   └── types.ts
│   ├── integrations/         # External service clients
│   │   ├── shopping-travel.ts
│   │   ├── beeper.ts
│   │   └── craft.ts
│   └── claude/
│       └── client.ts         # Claude API for healing
├── Dockerfile
├── fly.toml
└── package.json
```

## Self-Healing System

When browser automation fails due to DoorDash UI changes:

1. **Capture State** - Takes ARIA snapshot + screenshot
2. **Claude Analysis** - Asks Claude API to find the new element
3. **Update Patterns** - Stores new working selectors
4. **Retry Operation** - Continues with updated patterns
5. **Log Event** - Records healing for review

### Pattern Structure

```json
{
  "add_to_cart_button": {
    "description": "Button to add menu item to cart",
    "version": 3,
    "strategies": [
      {
        "type": "aria_role",
        "role": "button",
        "textContains": "Add to Order",
        "priority": 1
      }
    ],
    "healingHistory": [...]
  }
}
```

## MCP Tools

### `browse_restaurants`
Browse DoorDash restaurants, organized by cuisine.

```typescript
{
  location?: string,      // Delivery address
  cuisine_filter?: string // mexican, italian, chinese, etc.
}
```

### `get_recent_orders`
Get order history with reorder capability.

### `reorder`
Reorder a previous order by ID.

```typescript
{
  order_id: string
}
```

### `get_restaurant_menu`
Get restaurant menu with popular items first.

```typescript
{
  restaurant_id?: string,
  restaurant_name?: string
}
```

### `build_cart`
Add items to cart with customizations.

```typescript
{
  restaurant_id: string,
  items: [{
    name: string,
    quantity?: number,
    customizations?: string[],
    special_instructions?: string
  }]
}
```

### `view_cart`
View current cart contents.

### `clear_cart`
Clear all items from cart.

### `review_order`
Review order before placing - shows fees, delivery options, tip.

### `place_order`
Place order - **REQUIRES explicit confirmation**.

```typescript
{
  confirmation: "confirm" | "yes",  // Required!
  tip_amount?: number,
  delivery_priority?: "standard" | "priority"
}
```

### `track_order`
Get current order status and ETA. Auto-sends Beeper notifications.

### `set_location`
Set delivery address.

```typescript
{
  address: string
}
```

## GARZA OS Integration

This MCP server integrates with:

- **Shopping & Travel MCP** - Browser automation (`scraping_browser_*` tools)
- **Beeper MCP** - Order notifications
- **Craft MCP** - State persistence and logging
- **Claude API** - Self-healing pattern detection

## Setup

### Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials

# Build
npm run build

# Run (test mode)
TEST_MODE=true npm start
```

### Deploy to Fly.io

```bash
# Create app
fly apps create doordash-mcp --org personal

# Set secrets
fly secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  DOORDASH_EMAIL=your@email.com \
  DOORDASH_PASSWORD=... \
  BEEPER_CHAT_ID=!...:beeper.com \
  CRAFT_SPACE_ID=... \
  CRAFT_API_KEY=... \
  CRAFT_STATE_DOC_ID=... \
  CRAFT_PATTERN_DOC_ID=... \
  CRAFT_ERROR_LOG_DOC_ID=...

# Deploy
fly deploy

# Check status
fly status
fly logs
```

## Safety Guardrails

1. **Order Confirmation Required** - Never places order without explicit "confirm" or "yes"
2. **Order Review** - Always shows full summary before confirming
3. **Rate Limiting** - Max 3 healing attempts per pattern per hour
4. **Error Logging** - All errors logged to Craft
5. **Auto-Save** - State saved every 5 minutes
6. **Test Mode** - Set `TEST_MODE=true` to prevent real orders

## Example Usage

```
# Set delivery address
> set_location address="123 Main St, Denver, CO 80202"

# Browse restaurants
> browse_restaurants cuisine_filter="mexican"

# View menu
> get_restaurant_menu restaurant_name="Illegal Pete's"

# Build cart
> build_cart restaurant_id="illegal-petes" items=[
    {"name": "Mission Burrito", "quantity": 1, "customizations": ["carnitas", "guacamole"]}
  ]

# Review order
> review_order

# Place order (requires confirmation)
> place_order confirmation="confirm" tip_amount=5

# Track order
> track_order
```

## Troubleshooting

### Authentication Failed
- Check credentials in `.env`
- DoorDash may require 2FA - check email

### Pattern Healing Failing
- Check Craft error log for details
- Pattern may need manual update
- Verify Claude API key is valid

### Browser Automation Issues
- Shopping & Travel MCP must be running
- Check browser session state
- Try clearing session and re-authenticating

## License

MIT - Built for GARZA OS
