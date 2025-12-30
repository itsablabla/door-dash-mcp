/**
 * DoorDash MCP Types
 * Core type definitions for the DoorDash MCP server
 */

// Session Types
export interface Session {
  authenticated: boolean;
  lastActive: string;
  cookies: string;
  email: string;
  userId?: string;
}

// Cart Types
export interface CartItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  customizations: Customization[];
  specialInstructions?: string;
}

export interface Customization {
  name: string;
  options: string[];
  priceModifier: number;
}

export interface Cart {
  restaurantId: string;
  restaurantName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  total: number;
  deliveryAddress: string;
}

// Restaurant Types
export interface Restaurant {
  id: string;
  name: string;
  cuisine: string[];
  rating: number;
  deliveryTime: string;
  deliveryFee: number;
  priceLevel: string;
  imageUrl?: string;
  isOpen: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  isPopular: boolean;
  customizationOptions: CustomizationOption[];
  imageUrl?: string;
}

export interface CustomizationOption {
  name: string;
  required: boolean;
  maxSelections: number;
  options: {
    name: string;
    price: number;
  }[];
}

// Order Types
export interface Order {
  id: string;
  restaurantId: string;
  restaurantName: string;
  status: OrderStatus;
  items: CartItem[];
  total: number;
  createdAt: string;
  estimatedDelivery?: string;
  driver?: Driver;
  deliveryAddress: string;
  tip: number;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export interface Driver {
  name: string;
  phone?: string;
  vehicleType?: string;
  location?: {
    lat: number;
    lng: number;
  };
}

export interface RecentOrder {
  id: string;
  restaurantName: string;
  items: string[];
  total: number;
  date: string;
  canReorder: boolean;
}

// Pattern Types
export interface UIPattern {
  description: string;
  version: number;
  lastUpdated: string;
  strategies: PatternStrategy[];
  healingHistory: HealingEvent[];
}

export interface PatternStrategy {
  type: 'aria_role' | 'aria_ref' | 'css_selector' | 'text_contains' | 'xpath';
  priority: number;
  value?: string;
  role?: string;
  textContains?: string;
  ref?: string;
  context?: string;
}

export interface HealingEvent {
  date: string;
  change: string;
  oldStrategy: PatternStrategy;
  newStrategy: PatternStrategy;
  success: boolean;
}

export interface PatternLibrary {
  version: string;
  lastUpdated: string;
  patterns: Record<string, UIPattern>;
}

// State Types
export interface AppState {
  session: Session;
  cart: Cart | null;
  activeOrder: Order | null;
  deliveryAddress: string;
  lastPatternHeal: string;
  notificationInterval: NodeJS.Timeout | null;
}

// MCP Tool Types
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

// Integration Types
export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface SnapshotElement {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
  children?: SnapshotElement[];
}

// Error Types
export class DoorDashMCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'DoorDashMCPError';
  }
}

export class AuthenticationError extends DoorDashMCPError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', true);
    this.name = 'AuthenticationError';
  }
}

export class PatternHealingError extends DoorDashMCPError {
  constructor(message: string) {
    super(message, 'PATTERN_HEALING_ERROR', true);
    this.name = 'PatternHealingError';
  }
}

export class OrderError extends DoorDashMCPError {
  constructor(message: string, recoverable: boolean = false) {
    super(message, 'ORDER_ERROR', recoverable);
    this.name = 'OrderError';
  }
}
