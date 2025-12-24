import { unauthenticated } from 'app/shopify.server';
import type { ActionFunctionArgs } from 'react-router';
import { applyGiftSchema, applyGiftLogic } from 'app/services/applyGift.server';

/**
 * Action handler for applying gift rules to cart
 * Validates request, initializes APIs, and delegates to applyGiftLogic
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get('shop');
    console.log('[Gift Apply] Request received for shop:', shopDomain);

    if (!shopDomain) {
      console.warn('[Gift Apply] Shop domain missing');
      return Response.json(
        {
          applied: false,
          reason: 'Shop domain is required',
        },
        { status: 400 },
      );
    }

    // Validate request body
    const body = await request.json();
    console.log('[Gift Apply] Request body:', { cartId: body.cartId });
    
    const validationResult = applyGiftSchema.safeParse(body);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues[0]?.message || 'Invalid request data';
      console.warn('[Gift Apply] Validation failed:', validationResult.error.issues);
      return Response.json(
        {
          applied: false,
          reason: errorMessage,
        },
        { status: 400 },
      );
    }

    const { cartId } = validationResult.data;
    console.log('[Gift Apply] Validated cart ID:', cartId);

    // Initialize APIs
    console.log('[Gift Apply] Initializing APIs for shop:', shopDomain);
    const { storefront } = await unauthenticated.storefront(shopDomain);
    const { admin } = await unauthenticated.admin(shopDomain);

    if (!storefront) {
      console.error('[Gift Apply] Storefront API not available');
      return Response.json(
        {
          applied: false,
          reason: 'Storefront API not available',
        },
        { status: 503 },
      );
    }

    if (!admin) {
      console.error('[Gift Apply] Admin API not available');
      return Response.json(
        {
          applied: false,
          reason: 'Admin API not available',
        },
        { status: 503 },
      );
    }

    console.log('[Gift Apply] APIs initialized successfully');

    // Apply gift logic
    const result = await applyGiftLogic(storefront, admin, cartId);

    // Determine HTTP status based on result
    const status = result.applied || result.removed ? 200 : 400;

    return Response.json(result, { status });
  } catch (error) {
    console.error('[Gift Apply] ❌ Error applying gift:', error);
    return Response.json(
      {
        applied: false,
        reason: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
};

