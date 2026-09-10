import { z } from 'zod';
import { defineTool, isoDate, optBool, optNum, optStr, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { merchantNameFor } from '../lib/merchants.ts';
import {
  CREATE_TRANSACTION_Q,
  UPDATE_TRANSACTION_Q,
  SET_TRANSACTION_TAGS_Q,
  DELETE_TRANSACTION_Q,
  type Txn,
} from '../../monarch/ops/transactions.ts';
import { shapeTransaction } from '../read/transactions.ts';

type TxnPayload = { transaction: Txn | null; errors: PayloadError[] | null };

export const CreateTransaction = defineTool({
  name: 'CreateTransaction',
  title: 'Create transaction',
  description: `Create a manual transaction in the user's account.

Cross-entity references are by ID. Use the read tools to look up IDs first
(GetMerchants, GetCategories, GetAccounts, GetBusinesses, GetHouseholdMembers).
To attach a merchant that doesn't exist yet, pass merchant_name and Monarch creates it.`,
  readOnly: false,
  destructive: false,
  input: {
    date: isoDate.describe('ISO date (YYYY-MM-DD).'),
    amount: z.number().describe('Signed amount. Outflow (purchases, payments) is negative; inflow (income, refunds) is positive — same convention as GetTransactions.'),
    merchant_id: optStr.describe('ID of an existing merchant (from GetMerchants). Or pass merchant_name.'),
    merchant_name: optStr.describe('Merchant name; created on first use if new.'),
    category_id: z.string().describe('ID of an existing category (from GetCategories).'),
    account_id: z.string().describe('ID of an existing account (from GetAccounts). Manual accounts have their balance updated automatically.'),
    notes: optStr.describe('Optional free-text notes.'),
    hide_from_reports: optBool.describe('When true, the new transaction is excluded from budgets/reports.'),
    business_entity_id: optStr.describe('Optional business entity ID (from GetBusinesses) to attribute this to.'),
    owner_user_id: optStr.describe("Optional household member ID (from GetHouseholdMembers). Omit to inherit from the account's owner."),
    owner_is_joint: optBool.describe('Set true for shared ownership. Do not pass with owner_user_id.'),
  },
  handler: async (a) => {
    if (a.owner_user_id && a.owner_is_joint) throw new ToolInputError('pass owner_user_id or owner_is_joint, not both');
    const c = await getMonarch();
    const input: Record<string, unknown> = {
      date: a.date,
      amount: a.amount,
      merchantName: await merchantNameFor(c, a),
      categoryId: a.category_id,
      accountId: a.account_id,
      shouldUpdateBalance: true,
    };
    if (a.notes != null) input.notes = a.notes;
    if (a.business_entity_id != null) input.businessEntityId = a.business_entity_id;
    if (a.owner_user_id != null) input.ownerUserId = a.owner_user_id;
    const d = await c.query<{ createTransaction: TxnPayload }>(CREATE_TRANSACTION_Q, { input });
    assertNoPayloadErrors(d.createTransaction, 'CreateTransaction');
    let t = d.createTransaction.transaction!;
    if (a.hide_from_reports != null) {
      const u = await c.query<{ updateTransaction: TxnPayload }>(UPDATE_TRANSACTION_Q, { input: { id: t.id, hideFromReports: a.hide_from_reports } });
      assertNoPayloadErrors(u.updateTransaction, 'CreateTransaction(hide_from_reports)');
      t = u.updateTransaction.transaction ?? t;
    }
    return { transaction_id: t.id, transaction: shapeTransaction(t, true) };
  },
});

export const UpdateTransaction = defineTool({
  name: 'UpdateTransaction',
  title: 'Update transaction',
  description: `Update fields on a single transaction. Pass only the fields you want to change.

Cross-entity references are by ID — look them up with the read tools first.
Date and amount can only be changed on manual transactions; synced transactions
will return an error for those two fields.`,
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: {
    transaction_id: z.string().describe('ID from GetTransactions.'),
    date: optStr.describe('ISO date (YYYY-MM-DD). Manual transactions only.'),
    amount: optNum.describe('Signed amount. Manual transactions only.'),
    merchant_id: optStr,
    merchant_name: optStr,
    category_id: optStr,
    notes: optStr,
    hide_from_reports: optBool,
    is_recurring: optBool,
    review_status: z.enum(['needs_review', 'reviewed']).nullable().optional().describe("'needs_review' or 'reviewed'."),
    needs_review_by_user_id: optStr.describe('Household member ID (from GetHouseholdMembers) who should review this.'),
    owner_user_id: optStr.describe('Household member ID for ownership; or set owner_is_joint=true for shared. Do not pass both.'),
    owner_is_joint: optBool.describe('Set true for shared ownership.'),
    business_entity_id: optStr,
    tag_ids: z.array(z.string()).nullable().optional().describe('List of tag IDs (from GetTags). Replaces the existing tag set on the transaction (pass [] to clear all tags).'),
  },
  handler: async (a) => {
    if (a.owner_user_id && a.owner_is_joint) throw new ToolInputError('pass owner_user_id or owner_is_joint, not both');
    const c = await getMonarch();
    const input: Record<string, unknown> = { id: a.transaction_id };
    if (a.date != null) input.date = a.date;
    if (a.amount != null) input.amount = a.amount;
    if (a.merchant_id || a.merchant_name) input.name = await merchantNameFor(c, a);
    if (a.category_id != null) input.category = a.category_id;
    if (a.notes != null) input.notes = a.notes;
    if (a.hide_from_reports != null) input.hideFromReports = a.hide_from_reports;
    if (a.is_recurring != null) input.isRecurring = a.is_recurring;
    if (a.review_status === 'reviewed') input.reviewed = true;
    if (a.review_status === 'needs_review') input.needsReview = true;
    if (a.needs_review_by_user_id != null) {
      input.needsReview = true;
      input.needsReviewByUser = a.needs_review_by_user_id;
    }
    if (a.owner_user_id != null) input.ownerUserId = a.owner_user_id;
    if (a.owner_is_joint) input.ownerUserId = null;
    if (a.business_entity_id != null) input.businessEntityId = a.business_entity_id;

    let t: Txn | null = null;
    const fields = Object.keys(input).filter((k) => k !== 'id');
    if (fields.length) {
      const d = await c.query<{ updateTransaction: TxnPayload }>(UPDATE_TRANSACTION_Q, { input });
      assertNoPayloadErrors(d.updateTransaction, 'UpdateTransaction');
      t = d.updateTransaction.transaction;
    }
    if (a.tag_ids) {
      const d = await c.query<{ setTransactionTags: { transaction: { id: string; tags: Array<{ id: string; name: string }> } | null; errors: PayloadError[] | null } }>(
        SET_TRANSACTION_TAGS_Q,
        { input: { transactionId: a.transaction_id, tagIds: a.tag_ids } },
      );
      assertNoPayloadErrors(d.setTransactionTags, 'UpdateTransaction(tags)');
      if (t) t = { ...t, tags: d.setTransactionTags.transaction?.tags ?? [] };
      fields.push('tag_ids');
    }
    if (!fields.length) throw new ToolInputError('no fields to update');
    return { transaction_id: a.transaction_id, transaction: t ? shapeTransaction(t, true) : null, updated_fields: fields };
  },
});

export const DeleteTransaction = defineTool({
  name: 'DeleteTransaction',
  title: 'Delete transaction',
  description: 'Delete a transaction.',
  readOnly: false,
  destructive: true,
  input: { transaction_id: z.string() },
  handler: async ({ transaction_id }) => {
    const c = await getMonarch();
    const d = await c.query<{ deleteTransaction: { deleted: boolean | null; errors: PayloadError[] | null } }>(DELETE_TRANSACTION_Q, {
      input: { transactionId: transaction_id },
    });
    assertNoPayloadErrors(d.deleteTransaction, 'DeleteTransaction');
    return { deleted: d.deleteTransaction.deleted ?? true, transaction_id };
  },
});
