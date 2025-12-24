import { useEffect } from 'react';
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  giftRuleSchema,
  getGiftRuleConfig,
  saveGiftRule,
  mapValidationErrors,
  type GiftRuleConfig,
  type GiftRuleResult,
} from '../services/giftRule.server';

interface LoaderData extends GiftRuleConfig {}

interface ActionData extends GiftRuleResult {}

/**
 * Loader function that fetches existing gift rule configuration from app installation metafields
 * and returns them to populate the form with current values
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('[Gift Rule Loader] Starting to load gift rule configuration');

  const { admin } = await authenticate.admin(request);
  const config = await getGiftRuleConfig(admin);

  return config satisfies LoaderData;
};

/**
 * Action function that handles form submission for gift rule configuration
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  console.log('[Gift Rule Action] Starting form submission processing');

  const { admin, session } = await authenticate.admin(request);

  // Validate that we have a shop domain from the session
  if (!session?.shop) {
    console.error('[Gift Rule Action] ERROR: Unable to get shop domain from session');
    return {
      success: false,
      errors: { general: 'Unable to get shop domain' },
    } satisfies ActionData;
  }

  const shop = session.shop;
  console.log(`[Gift Rule Action] Processing for shop: ${shop}`);

  // Extract form data from the request
  const formData = await request.formData();
  const rawData = {
    giftVariantId: (formData.get('giftVariantId') as string) || '',
    minCartSubtotal: (formData.get('minCartSubtotal') as string) || '',
    enableRule: (formData.get('enableRule') as string) || '',
  };

  console.log('[Gift Rule Action] Raw form data received:', {
    giftVariantId: rawData.giftVariantId || '(empty)',
    minCartSubtotal: rawData.minCartSubtotal,
    enableRule: rawData.enableRule,
  });

  // Validate form data against the schema
  const validationResult = giftRuleSchema.safeParse(rawData);

  if (!validationResult.success) {
    console.warn('[Gift Rule Action] Validation failed:', validationResult.error.issues);
    const errors = mapValidationErrors(validationResult.error);
    return { success: false, errors } satisfies ActionData;
  }

  const validatedData = validationResult.data;
  console.log('[Gift Rule Action] Validation passed, processed data:', {
    giftVariantId: validatedData.giftVariantId,
    minCartSubtotal: validatedData.minCartSubtotal,
    enableRule: validatedData.enableRule,
  });

  // Delegate to service layer for business logic
  const result = await saveGiftRule(admin, validatedData);

  console.log('[Gift Rule Action] Form submission completed');
  return result satisfies ActionData;
};

/**
 * Gift Rule Configuration Page Component
 * Displays a form for configuring gift rules and handles form submission
 */
export default function GiftRule() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  // Track form submission state to show loading indicator
  const isSubmitting = navigation.state === 'submitting';

  // Show toast notifications based on action result
  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show('Gift rule saved successfully');
    } else if (actionData?.errors && Object.keys(actionData.errors).length > 0) {
      shopify.toast.show('Failed to save gift rule', { isError: true });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Gift Rule Configuration">
      <Form method="post">
        <s-section heading="Gift Rule Settings">
          <s-stack direction="block" gap="base">
            <s-text-field
              name="giftVariantId"
              label="Gift variant ID"
              details="Enter the variant ID for the gift product (e.g., gid://shopify/ProductVariant/123456789)"
              defaultValue={loaderData.giftVariantId}
              error={actionData?.errors?.giftVariantId}
            />

            <s-text-field
              name="minCartSubtotal"
              label="Min cart subtotal"
              details="Minimum cart subtotal required to trigger the gift rule (must be >= 0)"
              defaultValue={loaderData.minCartSubtotal}
              error={actionData?.errors?.minCartSubtotal}
            />

            <s-checkbox
              name="enableRule"
              defaultChecked={loaderData.enableRule}
              label="Enable rule"
            />

            {actionData?.errors?.general && (
              <s-banner tone="critical">
                {actionData.errors.general}
              </s-banner>
            )}

            <s-stack direction="inline" gap="base">
              <s-button
                type="submit"
                variant="primary"
                {...(isSubmitting ? { loading: true } : {})}
              >
                Save Gift Rule
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

