export interface Tag {
  id: string;
  name: string;
  color: string;
  order: number;
  transactionCount: number;
}

export const GET_TAGS_Q = /* GraphQL */ `
  query GetTags($search: String) {
    householdTransactionTags(search: $search) { id name color order transactionCount }
  }`;
export interface GetTagsData {
  householdTransactionTags: Tag[];
}

export const CREATE_TAG_Q = /* GraphQL */ `
  mutation CreateTag($input: CreateTransactionTagInput!) {
    createTransactionTag(input: $input) { tag { id name color order transactionCount } errors { message } }
  }`;
export const UPDATE_TAG_Q = /* GraphQL */ `
  mutation UpdateTag($input: UpdateTransactionTagInput!) {
    updateTransactionTag(input: $input) { tag { id name color order } errors { message } }
  }`;
export const DELETE_TAG_Q = /* GraphQL */ `
  mutation DeleteTag($tagId: ID!) {
    deleteTransactionTag(tagId: $tagId) { errors { message } }
  }`;
