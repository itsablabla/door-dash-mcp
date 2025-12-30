/**
 * Set Location Tool
 * Set delivery address
 */

import { NavigationHelper } from '../browser/navigation';
import { StateManager } from '../state/manager';
import { ToolResult } from '../state/types';

export interface SetLocationInput {
  address: string;
}

export class SetLocationTool {
  private navigation: NavigationHelper;
  private state: StateManager;

  constructor(navigation: NavigationHelper, state: StateManager) {
    this.navigation = navigation;
    this.state = state;
  }

  async execute(input: SetLocationInput): Promise<ToolResult> {
    try {
      // Ensure we're ready
      await this.navigation.ensureReady();

      // Set the address
      const success = await this.navigation.setDeliveryAddress(input.address);

      if (success) {
        // Save to state
        await this.state.setDeliveryAddress(input.address);

        return {
          success: true,
          message: `Delivery address set to: ${input.address}`,
        };
      }

      return {
        success: false,
        error:
          'Could not set delivery address. Please verify the address is valid and try again.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const setLocationSchema = {
  name: 'set_location',
  description: 'Set delivery address for DoorDash orders',
  inputSchema: {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string',
        description: 'Full delivery address',
      },
    },
    required: ['address'],
  },
};
