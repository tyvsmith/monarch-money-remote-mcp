export interface Account {
  id: string;
  displayName: string;
  notes: string | null;
  currentBalance: number | null;
  displayBalance: number | null;
  isAsset: boolean;
  isLiability: boolean;
  isHidden: boolean;
  isManual: boolean;
  includeInNetWorth: boolean;
  deactivatedAt: string | null;
  mask: string | null;
  apr: number | null;
  minimumPayment: number | null;
  plannedPayment: number | null;
  interestRate: number | null;
  limit: number | null;
  type: { name: string; display: string; group: string };
  subtype: { name: string; display: string };
  institution: { id: string; name: string } | null;
  ownedByUser: { id: string; displayName: string } | null;
  businessEntity: { id: string; name: string } | null;
  creditReportLiabilityAccount: { termsFrequency: string | null; liabilityType: string } | null;
}

export const GET_ACCOUNTS_Q = /* GraphQL */ `
  query GetAccounts($filters: AccountFilters) {
    accounts(filters: $filters) {
      id displayName notes currentBalance displayBalance isAsset isLiability isHidden isManual
      includeInNetWorth deactivatedAt mask apr minimumPayment plannedPayment interestRate limit
      type { name display group }
      subtype { name display }
      institution { id name }
      ownedByUser { id displayName }
      businessEntity { id name }
      creditReportLiabilityAccount { termsFrequency liabilityType }
    }
  }`;
export interface AccountsData {
  accounts: Account[];
}

export interface AccountTypeInfo {
  name: string;
  display: string;
  group: string;
  possibleSubtypes: Array<{ name: string; display: string }>;
}
export const ACCOUNT_TYPES_Q = /* GraphQL */ `
  query AccountTypes {
    accountTypes { name display group possibleSubtypes { name display } }
  }`;
export interface AccountTypesData {
  accountTypes: AccountTypeInfo[];
}
