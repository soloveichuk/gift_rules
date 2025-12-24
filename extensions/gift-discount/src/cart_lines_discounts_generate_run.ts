import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from '../generated/api';

/**
 * Apply 100% discount to cart lines with _is_gift attribute
 */
export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  // Early return if no cart lines
  if (!input.cart.lines.length) {
    return {operations: []};
  }

  // Check if discount has Product class (required for line item discounts)
  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  // Find all cart lines with _is_gift attribute
  const giftLines = input.cart.lines.filter((line) => {
    // Check if line has _is_gift attribute with value "true"
    return line.isGift?.value === 'true';
  });


  // If no gift items found, return no operations
  if (giftLines.length === 0) {
    return {operations: []};
  }

  // Apply 100% discount to all gift items
  // Create one operation with multiple candidates (one for each gift line)
  const operations = [
    {
      productDiscountsAdd: {
        candidates: giftLines.map((line) => ({
          message: 'Free gift item',
          targets: [
            {
              cartLine: {
                id: line.id,
              },
            },
          ],
          value: {
            percentage: {
              value: 100, // 100% discount
            },
          },
        })),
        selectionStrategy: ProductDiscountSelectionStrategy.First,
      },
    },
  ];

  return {
    operations,
  };
}