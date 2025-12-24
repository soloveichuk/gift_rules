import { z } from 'zod';
import { METAFIELDS_SET_MUTATION } from '../graphql/admin/metafieldsSet';
import { GET_APP_GIFT_RULES_METAFIELDS_QUERY } from '../graphql/admin/getAppGiftRulesMetafieldsQuery';
import { DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION } from '../graphql/admin/discountAutomaticAppCreate';
import { GET_CURRENT_APP_INSTALLATION_QUERY } from '../graphql/admin/getCurrentAppInstallation';

/**
 * Validation schema for gift rule form data
 */
export const giftRuleSchema = z.object({
  giftVariantId: z.string().min(1, 'Gift variant ID is required'),
  minCartSubtotal: z
    .string()
    .min(1, 'Min cart subtotal is required')
    .refine(
      (val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: 'Min cart subtotal must be a number >= 0' },
    ),
  enableRule: z
    .string()
    .optional()
    .transform((val) => val === 'on' || val === 'true'),
});

/**
 * Gift rule configuration data structure
 */
export interface GiftRuleConfig {
  giftVariantId: string;
  minCartSubtotal: string;
  enableRule: boolean;
}

/**
 * Result of gift rule operations
 */
export interface GiftRuleResult {
  success: boolean;
  errors?: Record<string, string>;
}

/**
 * Get current app installation ID from Admin API
 */
export async function getCurrentAppInstallationId(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<string | null> {
  console.log('[Gift Rule Service] Fetching current app installation ID');

  const response = await admin.graphql(GET_CURRENT_APP_INSTALLATION_QUERY);

  const json = await response.json();
  const installationId = json.data?.currentAppInstallation?.id;

  if (!installationId) {
    console.error('[Gift Rule Service] Failed to get current app installation ID');
    return null;
  }

  console.log('[Gift Rule Service] App installation ID:', installationId);
  return installationId;
}

/**
 * Load gift rule configuration from app installation metafields
 */
export async function getGiftRuleConfig(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<GiftRuleConfig> {
  console.log('[Gift Rule Service] Loading gift rule configuration');

  const defaultConfig: GiftRuleConfig = {
    giftVariantId: '',
    minCartSubtotal: '0',
    enableRule: false,
  };

  try {
    const response = await admin.graphql(GET_APP_GIFT_RULES_METAFIELDS_QUERY);
    const json = await response.json();
    const appInstallation = json.data?.currentAppInstallation;

    if (!appInstallation) {
      console.warn('[Gift Rule Service] No app installation data found, returning defaults');
      return defaultConfig;
    }

    const config: GiftRuleConfig = {
      giftVariantId: appInstallation.gift_variant_id?.value || '',
      minCartSubtotal: appInstallation.min_cart_subtotal?.value || '0',
      enableRule: appInstallation.enable_rule?.value === 'true',
    };

    console.log('[Gift Rule Service] Loaded configuration:', {
      giftVariantId: config.giftVariantId || '(empty)',
      minCartSubtotal: config.minCartSubtotal,
      enableRule: config.enableRule,
    });

    return config;
  } catch (error) {
    console.error('[Gift Rule Service] Error loading gift rule config:', error);
    return defaultConfig;
  }
}

/**
 * Prepare metafields array for gift rule configuration
 */
function prepareGiftRuleMetafields(
  config: z.infer<typeof giftRuleSchema>,
  appInstallationId: string,
) {
  return [
    {
      namespace: 'gift_rules',
      key: 'gift_variant_id',
      value: config.giftVariantId,
      type: 'single_line_text_field',
      ownerId: appInstallationId,
    },
    {
      namespace: 'gift_rules',
      key: 'min_cart_subtotal',
      value: config.minCartSubtotal,
      type: 'single_line_text_field',
      ownerId: appInstallationId,
    },
    {
      namespace: 'gift_rules',
      key: 'enable_rule',
      value: config.enableRule ? 'true' : 'false',
      type: 'single_line_text_field',
      ownerId: appInstallationId,
    },
  ];
}

/**
 * Save gift rule metafields to app installation
 */
export async function saveGiftRuleMetafields(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  config: z.infer<typeof giftRuleSchema>,
  appInstallationId: string,
): Promise<{ success: boolean; errors?: string[] }> {
  console.log('[Gift Rule Service] Saving gift rule metafields');

  const metafields = prepareGiftRuleMetafields(config, appInstallationId);

  try {
    const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields,
      },
    });

    const json = await response.json();
    console.log('[Gift Rule Service] MetafieldsSet response received');

    const userErrors = json.data?.metafieldsSet?.userErrors || [];

    if (userErrors.length > 0) {
      console.error('[Gift Rule Service] MetafieldsSet errors:', userErrors);
      return {
        success: false,
        errors: userErrors.map((error: { message: string }) => error.message),
      };
    }

    console.log('[Gift Rule Service] Metafields saved successfully');
    return { success: true };
  } catch (error) {
    console.error('[Gift Rule Service] Error saving metafields:', error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Failed to save metafields'],
    };
  }
}

/**
 * Create automatic app discount for gift items
 */
export async function createAutomaticAppDiscount(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<{ success: boolean; discountId?: string; errors?: string[] }> {
  console.log('[Gift Rule Service] Creating automatic app discount');

  const currentDate = new Date().toISOString();

  try {
    const response = await admin.graphql(DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION, {
      variables: {
        automaticAppDiscount: {
          functionHandle: 'gift-discount',
          title: '100% discount',
          startsAt: currentDate,
        },
      },
    });

    const json = await response.json();
    console.log('[Gift Rule Service] DiscountAutomaticAppCreate response received');

    const userErrors = json.data?.discountAutomaticAppCreate?.userErrors || [];

    if (userErrors.length > 0) {
      console.error('[Gift Rule Service] DiscountAutomaticAppCreate errors:', userErrors);
      return {
        success: false,
        errors: userErrors.map((error: { message: string }) => error.message),
      };
    }

    const discount = json.data?.discountAutomaticAppCreate?.automaticAppDiscount;

    if (discount) {
      console.log('[Gift Rule Service] Discount created successfully:', {
        discountId: discount.discountId,
        title: discount.title,
        status: discount.status,
      });

      return {
        success: true,
        discountId: discount.discountId,
      };
    }

    console.warn('[Gift Rule Service] Discount creation returned no discount data');
    return { success: false, errors: ['No discount data returned'] };
  } catch (error) {
    console.error('[Gift Rule Service] Error creating discount:', error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Failed to create discount'],
    };
  }
}

/**
 * Save gift rule configuration (metafields + discount)
 * This is the main function that orchestrates the save operation
 */
export async function saveGiftRule(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  config: z.infer<typeof giftRuleSchema>,
): Promise<GiftRuleResult> {
  console.log('[Gift Rule Service] Starting gift rule save operation');

  // Get app installation ID
  const appInstallationId = await getCurrentAppInstallationId(admin);

  if (!appInstallationId) {
    return {
      success: false,
      errors: { general: 'Failed to get current app installation' },
    };
  }

  // Save metafields
  const metafieldsResult = await saveGiftRuleMetafields(admin, config, appInstallationId);

  if (!metafieldsResult.success) {
    return {
      success: false,
      errors: {
        general: metafieldsResult.errors?.join(', ') || 'Failed to save gift rule',
      },
    };
  }

  // Create discount (non-blocking - we don't fail if this fails)
  const discountResult = await createAutomaticAppDiscount(admin);

  if (!discountResult.success) {
    console.warn('[Gift Rule Service] Discount creation failed, but metafields were saved');
    // We still return success because metafields were saved
  }

  console.log('[Gift Rule Service] Gift rule save operation completed successfully');
  return { success: true };
}

/**
 * Map Zod validation errors to form-friendly error format
 */
export function mapValidationErrors(
  error: z.ZodError,
): Record<string, string> {
  const errors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    if (issue.path[0]) {
      errors[issue.path[0] as string] = issue.message;
    }
  });

  return errors;
}

