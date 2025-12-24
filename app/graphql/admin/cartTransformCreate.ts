export const CART_TRANSFORM_CREATE_MUTATION = `#graphql
  mutation cartTransformCreate($functionHandle: String, $metafields: [MetafieldInput!]) {
    cartTransformCreate(functionHandle: $functionHandle, metafields: $metafields) {
      cartTransform {
        id
        metafields(first: 10) {
          nodes {
            id
            namespace
            ownerType
            key
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

