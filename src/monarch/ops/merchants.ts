export const GET_MERCHANTS_Q = /* GraphQL */ `
  query GetMerchants($search: String, $limit: Int, $orderBy: MerchantOrdering) {
    merchants(search: $search, limit: $limit, orderBy: $orderBy, includeMerchantsWithoutTransactions: true) {
      id name transactionCount
    }
  }`;
export interface MerchantsData {
  merchants: Array<{ id: string; name: string; transactionCount: number }>;
}

export const GET_MERCHANT_Q = /* GraphQL */ `
  query GetMerchant($id: ID) {
    merchant(id: $id) { id name transactionCount ruleCount canBeDeleted }
  }`;
export interface MerchantData {
  merchant: { id: string; name: string; transactionCount: number; ruleCount: number; canBeDeleted: boolean | null } | null;
}

export const UPDATE_MERCHANT_Q = /* GraphQL */ `
  mutation UpdateMerchant($input: UpdateMerchantInput!) {
    updateMerchant(input: $input) {
      merchant { id name transactionCount }
      errors { message fieldErrors { field messages } }
    }
  }`;
// Monarch has no standalone merchant delete; this moves relations to another
// merchant and removes the source, which is the merge primitive.
export const DELETE_MERCHANT_Q = /* GraphQL */ `
  mutation DeleteMerchant($id: ID!, $to: ID) {
    deleteMerchant(id: $id, moveRelationsToMerchantId: $to) { success }
  }`;
