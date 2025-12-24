import { GET_APP_GIFT_RULES_METAFIELDS_QUERY } from "../graphql/admin/getAppGiftRulesMetafieldsQuery";
import { z } from "zod";
import { GET_CART_QUERY } from "../graphql/storefront/getCartQuery";
import { ADD_GIFT_ITEM_TO_CART_MUTATION } from "../graphql/storefront/addGiftItemToCart";
import { REMOVE_GIFT_ITEM_FROM_CART_MUTATION } from "../graphql/storefront/removeGiftItemFromCart";
import { UPDATE_CART_LINE_QUANTITY_MUTATION } from "../graphql/storefront/updateCartLineQuantity";

const GIFT_ATTRIBUTE_KEY = '_is_gift';
const GIFT_ATTRIBUTE_VALUE = 'true';

/**
 * Cart data types
 */
export interface CartLineNode {
  id?: string;
  quantity?: number;
  cost?: {
    totalAmount?: {
      amount?: string;
      currencyCode?: string;
    };
  };
  merchandise?: {
    id?: string;
  };
  attributes?: Array<{
    key?: string;
    value?: string;
  }>;
}

export interface CartData {
  id?: string;
  cost?: {
    subtotalAmount?: {
      amount?: string;
      currencyCode?: string;
    };
  };
  lines?: {
    edges?: Array<{
      node?: CartLineNode;
    }>;
  };
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export interface GraphQLMutationResponse<T = unknown> {
  data?: {
    [key: string]: {
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } & T;
  };
  errors?: Array<{ message?: string }>;
}

export interface ApplyGiftResult {
  applied: boolean;
  removed?: boolean;
  reason: string;
}

export interface GiftRule {
  giftVariantId: string;
  minCartSubtotal: number;
  enableRule: boolean;
}

/**
 * Helper function to get gift rules from metafields using Admin API
 */
export async function getGiftRules(
  graphql: (query: string) => Promise<Response>
): Promise<GiftRule | null> {
  try {
    const response = await graphql(GET_APP_GIFT_RULES_METAFIELDS_QUERY);
    
    if (!response.ok) {
      console.error('Failed to fetch metafields:', response.status, response.statusText);
      return null;
    }

    const responseJson = await response.json();
    const appInstallation = responseJson.data?.currentAppInstallation;

    if (!appInstallation) {
      return null;
    }

    const giftVariantId = appInstallation.gift_variant_id?.value || '';
    const minCartSubtotalStr = appInstallation.min_cart_subtotal?.value || '0';
    const enableRule = appInstallation.enable_rule?.value === 'true';

    if (!giftVariantId) {
      return null;
    }

    return {
      giftVariantId,
      minCartSubtotal: parseFloat(minCartSubtotalStr) || 0,
      enableRule,
    };
  } catch (error) {
    console.error('Error fetching gift rules:', error);
    return null;
  }
}

export const applyGiftSchema = z.object({
  cartId: z.string().min(1, 'Cart ID is required'),
});

/**
 * Check if a cart line is a gift item based on the _is_gift attribute
 */
function isGiftItem(node: CartLineNode | undefined): boolean {
  if (!node) return false;
  const attributes = node.attributes || [];
  return attributes.some(
    (attr) => attr.key === GIFT_ATTRIBUTE_KEY && attr.value === GIFT_ATTRIBUTE_VALUE
  );
}

/**
 * Calculate cart subtotal excluding gift items
 */
export function calculateSubtotalWithoutGifts(cartLines: CartData['lines']): number {
  const edges = cartLines?.edges || [];
  let subtotal = 0;
  
  for (const edge of edges) {
    const node = edge.node;
    if (!node) continue;
    
    if (isGiftItem(node)) {
      console.log('[Gift Apply] Skipping gift item in subtotal calculation:', node.id);
      continue;
    }
    
    const lineCost = parseFloat(node.cost?.totalAmount?.amount || '0');
    subtotal += lineCost;
  }
  
  return subtotal;
}

/**
 * Find gift line item in cart
 */
export function findGiftLine(cartLines: CartData['lines']): CartLineNode | null {
  const edges = cartLines?.edges || [];
  const giftEdge = edges.find((edge) => isGiftItem(edge.node));
  return giftEdge?.node || null;
}

/**
 * Find all gift line IDs in cart
 */
export function findGiftLineIds(cartLines: CartData['lines']): string[] {
  const edges = cartLines?.edges || [];
  return edges
    .filter((edge) => isGiftItem(edge.node))
    .map((edge) => edge.node?.id)
    .filter((id): id is string => !!id);
}

/**
 * Handle GraphQL errors and user errors
 */
function handleGraphQLErrors<T>(
  response: GraphQLMutationResponse<T>,
  operation: string
): { success: false; reason: string } | { success: true } {
  if (response.errors && response.errors.length > 0) {
    console.error(`[Gift Apply] GraphQL errors when ${operation}:`, response.errors);
    return {
      success: false,
      reason: response.errors[0]?.message || `Failed to ${operation}`,
    };
  }

  // Find userErrors in the response (they can be in any mutation result)
  const mutationKeys = Object.keys(response.data || {});
  for (const key of mutationKeys) {
    const mutationResult = response.data?.[key];
    if (mutationResult?.userErrors && mutationResult.userErrors.length > 0) {
      console.error(`[Gift Apply] User errors when ${operation}:`, mutationResult.userErrors);
      return {
        success: false,
        reason: mutationResult.userErrors[0]?.message || `Failed to ${operation}`,
      };
    }
  }

  return { success: true };
}

/**
 * Get cart data from Storefront API
 */
export async function getCartData(
  storefront: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  cartGid: string
): Promise<{ success: false; reason: string } | { success: true; cart: CartData }> {
  console.log('[Gift Apply] Fetching cart data...');
  const cartResponse = await storefront.graphql(GET_CART_QUERY, {
    variables: { id: cartGid },
  });

  const cartJson = (await cartResponse.json()) as GraphQLResponse<{ cart?: CartData }>;

  if (cartJson.errors && cartJson.errors.length > 0) {
    console.error('[Gift Apply] GraphQL errors when fetching cart:', cartJson.errors);
    return {
      success: false,
      reason: cartJson.errors[0]?.message || 'Failed to fetch cart',
    };
  }

  const cartData = cartJson.data?.cart;
  if (!cartData) {
    console.warn('[Gift Apply] Cart not found:', cartGid);
    return {
      success: false,
      reason: 'Cart not found',
    };
  }

  return { success: true, cart: cartData };
}

/**
 * Remove gift items from cart
 */
export async function removeGiftItems(
  storefront: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  cartGid: string,
  giftLineIds: string[]
): Promise<{ success: false; reason: string } | { success: true }> {
  if (giftLineIds.length === 0) {
    return { success: true };
  }

  console.log('[Gift Apply] Removing gift items from cart. Line IDs:', giftLineIds);
  
  const removeGiftResponse = await storefront.graphql(REMOVE_GIFT_ITEM_FROM_CART_MUTATION, {
    variables: {
      cartId: cartGid,
      lineIds: giftLineIds,
    },
  });

  const removeGiftJson = (await removeGiftResponse.json()) as GraphQLMutationResponse;

  const errorResult = handleGraphQLErrors(removeGiftJson, 'removing gift');
  if (!errorResult.success) {
    return errorResult;
  }

  console.log('[Gift Apply] ✅ Gift items removed from cart successfully');
  return { success: true };
}

/**
 * Update gift item quantity to 1
 */
export async function updateGiftQuantity(
  storefront: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  cartGid: string,
  giftLineId: string
): Promise<{ success: false; reason: string } | { success: true }> {
  console.log('[Gift Apply] Updating gift quantity to 1...');
  
  const updateQuantityResponse = await storefront.graphql(UPDATE_CART_LINE_QUANTITY_MUTATION, {
    variables: {
      cartId: cartGid,
      lines: [
        {
          id: giftLineId,
          quantity: 1,
        },
      ],
    },
  });

  const updateQuantityJson = (await updateQuantityResponse.json()) as GraphQLMutationResponse;

  const errorResult = handleGraphQLErrors(updateQuantityJson, 'updating quantity');
  if (!errorResult.success) {
    return errorResult;
  }

  console.log('[Gift Apply] ✅ Gift quantity updated to 1 successfully');
  return { success: true };
}

/**
 * Add gift item to cart
 */
export async function addGiftItem(
  storefront: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  cartGid: string,
  giftVariantId: string
): Promise<{ success: false; reason: string } | { success: true }> {
  console.log('[Gift Apply] Adding gift variant to cart with _is_gift attribute...');
  
  const addGiftResponse = await storefront.graphql(ADD_GIFT_ITEM_TO_CART_MUTATION, {
    variables: {
      cartId: cartGid,
      lines: [
        {
          quantity: 1,
          merchandiseId: giftVariantId,
          attributes: [
            {
              key: GIFT_ATTRIBUTE_KEY,
              value: GIFT_ATTRIBUTE_VALUE,
            },
          ],
        },
      ],
    },
  });

  const addGiftJson = (await addGiftResponse.json()) as GraphQLMutationResponse;

  const errorResult = handleGraphQLErrors(addGiftJson, 'adding gift');
  if (!errorResult.success) {
    return errorResult;
  }

  console.log('[Gift Apply] ✅ Gift applied successfully!');
  return { success: true };
}

/**
 * Main logic for applying gift rules to cart
 */
export async function applyGiftLogic(
  storefront: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  cartId: string
): Promise<ApplyGiftResult> {
  // Get gift rules
  console.log('[Gift Apply] Fetching gift rules...');
  const giftRules = await getGiftRules(admin.graphql);
  console.log('[Gift Apply] Gift rules:', giftRules);
  
  if (!giftRules) {
    console.warn('[Gift Apply] Gift rules not configured');
    return {
      applied: false,
      reason: 'Gift rules not configured',
    };
  }

  // Check if rule is enabled
  if (!giftRules.enableRule) {
    console.log('[Gift Apply] Gift rule is disabled');
    return {
      applied: false,
      reason: 'Gift rule is disabled',
    };
  }

  console.log('[Gift Apply] Gift rule is enabled, checking cart...');

  // Prepare cart ID
  const cartGid = cartId.startsWith('gid://') ? cartId : `gid://shopify/Cart/${cartId}`;
  console.log('[Gift Apply] Cart GID:', cartGid);

  // Get cart data
  const cartResult = await getCartData(storefront, cartGid);
  if (!cartResult.success) {
    return {
      applied: false,
      reason: cartResult.reason,
    };
  }

  const cartData = cartResult.cart;
  console.log('[Gift Apply] Cart data:', cartData.lines?.edges);

  // Calculate subtotal excluding gift items
  const subtotalAmount = calculateSubtotalWithoutGifts(cartData.lines);
  const minSubtotal = giftRules.minCartSubtotal;
  console.log('[Gift Apply] Cart subtotal (excluding gifts):', subtotalAmount, '| Minimum required:', minSubtotal);

  // Check if cart subtotal meets minimum requirement
  if (subtotalAmount < minSubtotal) {
    console.log('[Gift Apply] Cart subtotal too low. Current:', subtotalAmount, 'Required:', minSubtotal);
    
    // Find and remove gift items from cart
    const giftLineIds = findGiftLineIds(cartData.lines);
    
    if (giftLineIds.length > 0) {
      const removeResult = await removeGiftItems(storefront, cartGid, giftLineIds);
      if (!removeResult.success) {
        return {
          applied: false,
          reason: removeResult.reason,
        };
      }

      return {
        applied: false,
        removed: true,
        reason: `Cart subtotal (${subtotalAmount}) is less than minimum required (${minSubtotal}). Gift items have been removed.`,
      };
    }

    return {
      applied: false,
      reason: `Cart subtotal (${subtotalAmount}) is less than minimum required (${minSubtotal})`,
    };
  }

  // Check for all gift items in cart
  const allGiftLineIds = findGiftLineIds(cartData.lines);
  console.log('[Gift Apply] Found gift items in cart:', allGiftLineIds.length);
  console.log('[Gift Apply] Cart lines count:', cartData.lines?.edges?.length || 0);
  console.log('[Gift Apply] Gift variant ID:', giftRules.giftVariantId);

  // Find the correct gift item (with matching variantId and _is_gift attribute)
  const giftLine = cartData.lines?.edges?.find((edge) => {
    const node = edge.node;
    if (!node || !isGiftItem(node)) return false;
    // Check if variantId matches
    return node.merchandise?.id === giftRules.giftVariantId;
  })?.node;

  console.log('[Gift Apply] Correct gift item exists in cart:', !!giftLine);

  // If there are multiple gift items or wrong gift items, remove them first
  // Keep only the correct one (if it exists)
  const giftItemsToRemove = allGiftLineIds.filter((id) => id !== giftLine?.id);
  
  if (giftItemsToRemove.length > 0) {
    console.log('[Gift Apply] Removing incorrect or duplicate gift items:', giftItemsToRemove);
    const removeResult = await removeGiftItems(storefront, cartGid, giftItemsToRemove);
    if (!removeResult.success) {
      return {
        applied: false,
        reason: removeResult.reason,
      };
    }
  }

  // If correct gift item exists, ensure it has quantity = 1
  if (giftLine && giftLine.id) {
    const giftQuantity = giftLine.quantity || 0;
    console.log('[Gift Apply] Gift found in cart with quantity:', giftQuantity);

    // If quantity is greater than 1, update it to 1
    if (giftQuantity > 1) {
      const updateResult = await updateGiftQuantity(storefront, cartGid, giftLine.id);
      if (!updateResult.success) {
        return {
          applied: false,
          reason: updateResult.reason,
        };
      }

      return {
        applied: true,
        reason: 'Gift quantity updated to 1',
      };
    } else {
      // Gift already exists with correct quantity (1) and correct variantId
      console.log('[Gift Apply] Gift already in cart with correct quantity (1) and variantId, skipping');
      return {
        applied: false,
        reason: 'Gift already added to cart with correct quantity',
      };
    }
  }

  // Add gift variant to cart
  const addResult = await addGiftItem(storefront, cartGid, giftRules.giftVariantId);
  if (!addResult.success) {
    return {
      applied: false,
      reason: addResult.reason,
    };
  }

  return {
    applied: true,
    reason: 'Gift applied successfully',
  };
}