export const RECURRING_Q = /* GraphQL */ `
  query Recurring($includeLiabilities: Boolean, $includePending: Boolean) {
    recurringTransactionStreams(includeLiabilities: $includeLiabilities, includePending: $includePending) {
      stream {
        id name frequency amount isActive isApproximate recurringType reviewStatus dayOfTheMonth baseDate
        merchant { id name }
        creditReportLiabilityAccount { id name liabilityType }
      }
      account { id displayName }
      category { id name group { id name type } }
      nextForecastedTransaction { date amount }
    }
  }`;
export interface RecurringItem {
  stream: {
    id: string;
    name: string;
    frequency: string;
    amount: number | null;
    isActive: boolean;
    isApproximate: boolean;
    recurringType: string | null;
    reviewStatus: string | null;
    dayOfTheMonth: number | null;
    baseDate: string;
    merchant: { id: string; name: string } | null;
    creditReportLiabilityAccount: { id: string; name: string | null; liabilityType: string } | null;
  };
  account: { id: string; displayName: string } | null;
  category: { id: string; name: string; group: { id: string; name: string; type: string } } | null;
  nextForecastedTransaction: { date: string; amount: number };
}
export interface RecurringData {
  recurringTransactionStreams: RecurringItem[];
}
