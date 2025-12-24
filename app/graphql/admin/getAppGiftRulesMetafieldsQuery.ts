export const GET_APP_GIFT_RULES_METAFIELDS_QUERY = `#graphql
  query getAppGiftRulesMetafields {
    currentAppInstallation {
      id
      gift_variant_id: metafield(namespace: "gift_rules", key: "gift_variant_id") {
        value
      }
      min_cart_subtotal: metafield(namespace: "gift_rules", key: "min_cart_subtotal") {
        value
      }
      enable_rule: metafield(namespace: "gift_rules", key: "enable_rule") {
        value
      }
    }
  }
`;