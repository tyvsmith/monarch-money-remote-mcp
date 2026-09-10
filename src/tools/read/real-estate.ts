import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { fetchAccounts, shapeAccount } from './accounts.ts';

const HOME_LOAN_SUBTYPES = new Set(['mortgage', 'home_equity', 'home_equity_line_of_credit', 'home_equity_loan', 'heloc']);

export const GetRealEstate = defineTool({
  name: 'GetRealEstate',
  title: 'Real estate',
  description: `List the user's real estate properties and their related home loans.

Returns each property (id, name, type, current value) and each property
loan (mortgage, home equity, etc., with current balance), plus a computed
total equity (property value minus loan balance).

If the user has property loans but no real estate accounts, equity cannot
be computed and the response includes a \`message\` explaining how to add
a property to fix that.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const all = (await fetchAccounts(c, {})).filter((a) => !a.deactivatedAt);
    const properties = all.filter((a) => a.type.name === 'real_estate');
    const loans = all.filter((a) => a.type.name === 'loan' && HOME_LOAN_SUBTYPES.has(a.subtype.name));
    const value = properties.reduce((s, a) => s + (a.displayBalance ?? 0), 0);
    const debt = loans.reduce((s, a) => s + (a.displayBalance ?? 0), 0);
    return {
      properties: properties.map(shapeAccount),
      loans: loans.map(shapeAccount),
      total_property_value: value,
      total_loan_balance: debt,
      total_equity: properties.length ? value - debt : null,
      ...(loans.length && !properties.length
        ? { message: 'Property loans exist but no real estate account does, so equity cannot be computed. Add the property in Monarch (Accounts → Add → Real estate) to fix that.' }
        : {}),
    };
  },
});
