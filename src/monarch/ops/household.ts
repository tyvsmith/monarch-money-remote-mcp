export interface HouseholdUser {
  id: string;
  name: string;
  displayName: string;
  householdRole: string;
}
export const GET_HOUSEHOLD_Q = /* GraphQL */ `
  query GetHousehold {
    me { id }
    myHousehold { id name users { id name displayName householdRole } }
  }`;
export interface HouseholdData {
  me: { id: string };
  myHousehold: { id: string; name: string; users: HouseholdUser[] };
}

export const GET_BUSINESSES_Q = /* GraphQL */ `
  query GetBusinesses {
    businessEntities { id name structure description accountsCount transactionsCount }
  }`;
export interface BusinessesData {
  businessEntities: Array<{
    id: string;
    name: string;
    structure: string;
    description: string | null;
    accountsCount: number;
    transactionsCount: number;
  }>;
}
