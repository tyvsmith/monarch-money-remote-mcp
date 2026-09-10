export const HOLDINGS_Q = /* GraphQL */ `
  query Holdings($input: PortfolioInput) {
    portfolio(input: $input) {
      performance { totalValue totalCostBasis totalChangeDollars totalChangePercent oneDayChangeDollars oneDayChangePercent }
      aggregateHoldings {
        edges {
          node {
            id quantity costBasis totalValue allocationPercent
            securityPriceChangeDollars securityPriceChangePercent totalGainLossDollars totalGainLossPercent
            security { id name ticker type typeDisplay assetClass currentPrice }
            holdings { id name ticker quantity value costBasis account { id displayName } }
          }
        }
      }
    }
  }`;
export interface HoldingNode {
  id: string;
  quantity: number;
  costBasis: number;
  totalValue: number;
  allocationPercent: number;
  securityPriceChangeDollars: number | null;
  securityPriceChangePercent: number | null;
  totalGainLossDollars: number | null;
  totalGainLossPercent: number | null;
  security: { id: string; name: string; ticker: string | null; type: string; typeDisplay: string; assetClass: string | null; currentPrice: number | null } | null;
  holdings: Array<{ id: string; name: string | null; ticker: string | null; quantity: number | null; value: number | null; costBasis: number | null; account: { id: string; displayName: string } | null }>;
}
export interface HoldingsData {
  portfolio: {
    performance: { totalValue: number; totalCostBasis: number; totalChangeDollars: number; totalChangePercent: number; oneDayChangeDollars: number; oneDayChangePercent: number };
    aggregateHoldings: { edges: Array<{ node: HoldingNode } | null> };
  };
}
