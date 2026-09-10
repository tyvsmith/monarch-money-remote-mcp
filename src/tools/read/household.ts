import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GET_HOUSEHOLD_Q, GET_BUSINESSES_Q, type HouseholdData, type BusinessesData } from '../../monarch/ops/household.ts';

export const GetHouseholdMembers = defineTool({
  name: 'GetHouseholdMembers',
  title: 'List household members',
  description: `List the members of the authenticated user's household.

Returns each member's stable \`user_id\`, \`name\`, \`display_name\`, and
\`household_role\`. Use this to discover the \`user_id\` before assigning
transaction ownership or a reviewer.

Pass \`user_id\` to the \`owner_user_id\` / \`needs_review_by_user_id\` write inputs.
For shared ownership, set \`owner_is_joint=true\` instead of passing \`owner_user_id\`.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const d = await c.query<HouseholdData>(GET_HOUSEHOLD_Q);
    return {
      household_id: d.myHousehold.id,
      household_name: d.myHousehold.name,
      current_user_id: d.me.id,
      members: d.myHousehold.users.map((u) => ({
        user_id: u.id,
        name: u.name,
        display_name: u.displayName,
        household_role: u.householdRole,
        is_current_user: u.id === d.me.id,
      })),
    };
  },
});

export const GetBusinesses = defineTool({
  name: 'GetBusinesses',
  title: 'List businesses',
  description: `List the businesses the user has set up for tracking (e.g. LLCs, side hustles).

Returns each business's stable \`id\`, name, and structure (e.g. llc,
sole_proprietorship), along with how many accounts and how many transactions
are tied to it.

Use this to discover businesses before filtering other tools by business, or
when the user asks "what businesses do I have?". Pass a business \`id\` to the write
tools that take \`business_entity_id\`.

Requires an active Monarch Plus subscription.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const d = await c.query<BusinessesData>(GET_BUSINESSES_Q);
    return {
      businesses: d.businessEntities.map((b) => ({
        id: b.id,
        name: b.name,
        structure: b.structure,
        description: b.description,
        account_count: b.accountsCount,
        transaction_count: b.transactionsCount,
      })),
    };
  },
});
