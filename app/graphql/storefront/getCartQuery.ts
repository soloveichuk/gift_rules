export const GET_CART_QUERY = `#graphql
  query getCart($id: ID!) {
    cart(id: $id) {
      id
      cost {
        subtotalAmount {
          amount
          currencyCode
        }
      }
      lines(first: 250) {
        edges {
          node {
            id
            quantity
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
            merchandise {
              ... on ProductVariant {
                id
              }
            }
            attributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;