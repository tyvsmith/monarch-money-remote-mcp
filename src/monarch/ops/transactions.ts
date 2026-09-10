export const TXN_FIELDS = /* GraphQL */ `
  id date amount pending isRecurring hideFromReports needsReview reviewStatus notes
  dataProviderDescription isSplitTransaction hasSplitTransactions isManual
  merchant { id name }
  category { id name group { id name type } }
  account { id displayName }
  businessEntity { id name }
  ownedByUser { id displayName }
  needsReviewByUser { id displayName }
  goal { id name }
  tags { id name }
  splitTransactions { id amount notes merchant { id name } category { id name } tags { id name } }
  attachments { id filename }`;

export interface Txn {
  id: string;
  date: string;
  amount: number;
  pending: boolean;
  isRecurring: boolean;
  hideFromReports: boolean;
  needsReview: boolean;
  reviewStatus: string | null;
  notes: string | null;
  dataProviderDescription: string | null;
  isSplitTransaction: boolean;
  hasSplitTransactions: boolean;
  isManual: boolean;
  merchant: { id: string; name: string };
  category: { id: string; name: string; group: { id: string; name: string; type: string } };
  account: { id: string; displayName: string };
  businessEntity: { id: string; name: string } | null;
  ownedByUser: { id: string; displayName: string } | null;
  needsReviewByUser: { id: string; displayName: string } | null;
  goal: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string }>;
  splitTransactions: Array<{
    id: string;
    amount: number;
    notes: string | null;
    merchant: { id: string; name: string };
    category: { id: string; name: string };
    tags: Array<{ id: string; name: string }>;
  }>;
  attachments: Array<{ id: string; filename: string | null }>;
}

export const GET_TRANSACTIONS_Q = /* GraphQL */ `
  query GetTransactions($filters: TransactionFilterInput, $limit: Int, $offset: Int, $orderBy: TransactionOrdering) {
    allTransactions(filters: $filters) {
      totalCount
      results(limit: $limit, offset: $offset, orderBy: $orderBy) { ${TXN_FIELDS} }
    }
  }`;
export interface TransactionsData {
  allTransactions: { totalCount: number; results: Txn[] };
}

export const COUNT_TRANSACTIONS_Q = /* GraphQL */ `
  query CountTransactions($filters: TransactionFilterInput) {
    allTransactions(filters: $filters) { totalCount }
  }`;
export interface CountData {
  allTransactions: { totalCount: number };
}

export const GET_TRANSACTION_Q = /* GraphQL */ `
  query GetTransaction($id: UUID!) {
    getTransaction(id: $id) { ${TXN_FIELDS} }
  }`;
export interface TransactionData {
  getTransaction: Txn | null;
}

export const CREATE_TRANSACTION_Q = /* GraphQL */ `
  mutation CreateTransaction($input: CreateTransactionMutationInput!) {
    createTransaction(input: $input) {
      transaction { ${TXN_FIELDS} }
      errors { message fieldErrors { field messages } }
    }
  }`;
export const UPDATE_TRANSACTION_Q = /* GraphQL */ `
  mutation UpdateTransaction($input: UpdateTransactionMutationInput!) {
    updateTransaction(input: $input) {
      transaction { ${TXN_FIELDS} }
      errors { message fieldErrors { field messages } }
    }
  }`;
export const SET_TRANSACTION_TAGS_Q = /* GraphQL */ `
  mutation SetTransactionTags($input: SetTransactionTagsInput!) {
    setTransactionTags(input: $input) {
      transaction { id tags { id name } }
      errors { message fieldErrors { field messages } }
    }
  }`;
export const DELETE_TRANSACTION_Q = /* GraphQL */ `
  mutation DeleteTransaction($input: DeleteTransactionMutationInput!) {
    deleteTransaction(input: $input) { deleted errors { message fieldErrors { field messages } } }
  }`;
export const BULK_UPDATE_TRANSACTIONS_Q = /* GraphQL */ `
  mutation BulkUpdateTransactions(
    $selectedTransactionIds: [ID!]
    $allSelected: Boolean!
    $expectedAffectedTransactionCount: Int
    $updates: TransactionUpdateParams!
    $filters: TransactionFilterInput
  ) {
    bulkUpdateTransactions(
      selectedTransactionIds: $selectedTransactionIds
      allSelected: $allSelected
      expectedAffectedTransactionCount: $expectedAffectedTransactionCount
      updates: $updates
      filters: $filters
    ) { success affectedCount errors { message } }
  }`;
export const UPDATE_SPLITS_Q = /* GraphQL */ `
  mutation UpdateSplits($input: UpdateTransactionSplitMutationInput!) {
    updateTransactionSplit(input: $input) {
      transaction {
        id amount hasSplitTransactions
        splitTransactions { id amount notes merchant { id name } category { id name } tags { id name } }
      }
      errors { message fieldErrors { field messages } }
    }
  }`;
