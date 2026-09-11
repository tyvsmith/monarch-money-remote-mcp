import { z } from 'zod';
import { defineTool, optStr } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { CREATE_CATEGORY_Q, UPDATE_CATEGORY_Q, DELETE_CATEGORY_Q } from '../../monarch/ops/categories.ts';

type CatPayload = { category: { id: string; name: string; icon: string; group: { id: string; name: string } } | null; errors: PayloadError[] | null };
const shape = (k: NonNullable<CatPayload['category']>) => ({ category_id: k.id, name: k.name, icon: k.icon, group_id: k.group.id, group: k.group.name });

export const CreateCategory = defineTool({
  name: 'CreateCategory',
  title: 'Create category',
  description: 'Create a custom category in the household.',
  readOnly: false,
  destructive: false,
  input: {
    name: z.string().describe('Category name. Must be unique in the household.'),
    group_id: z.string().describe('ID of the existing category group to place this under (from GetCategories).'),
    icon: optStr.describe('Optional emoji or icon string.'),
  },
  handler: async ({ name, group_id, icon }) => {
    const c = await getMonarch();
    const d = await c.query<{ createCategory: CatPayload }>(CREATE_CATEGORY_Q, { input: { name, group: group_id, icon: icon ?? '🏷️' } });
    assertNoPayloadErrors(d.createCategory, 'CreateCategory');
    return shape(d.createCategory.category!);
  },
});

export const UpdateCategory = defineTool({
  name: 'UpdateCategory',
  title: 'Update category',
  description: 'Rename, re-group, or re-icon a custom category. System categories cannot be modified.\n\nPass only the fields you want to change. `group_id` is a category group ID from GetCategories.',
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: { category_id: z.string(), name: optStr, group_id: optStr, icon: optStr },
  handler: async ({ category_id, name, group_id, icon }) => {
    const c = await getMonarch();
    const input: Record<string, unknown> = { id: category_id };
    if (name != null) input.name = name;
    if (group_id != null) input.group = group_id;
    if (icon != null) input.icon = icon;
    const d = await c.query<{ updateCategory: CatPayload }>(UPDATE_CATEGORY_Q, { input });
    assertNoPayloadErrors(d.updateCategory, 'UpdateCategory');
    return shape(d.updateCategory.category!);
  },
});

export const DeleteCategory = defineTool({
  name: 'DeleteCategory',
  title: 'Delete category',
  description: `Delete a custom category. System categories cannot be deleted.

The category must have zero transactions assigned and no rules referencing it. If transactions
are still on it, first move them to another category (UpdateTransaction or
BulkUpdateTransactions). If rules reference it (as a filter, set-category action, or split),
update or delete those rules (ListRules, DeleteRule) first. Then retry the delete.`,
  readOnly: false,
  destructive: true,
  input: { category_id: z.string() },
  handler: async ({ category_id }) => {
    const c = await getMonarch();
    const d = await c.query<{ deleteCategory: { deleted: boolean | null; errors: PayloadError[] | null } }>(DELETE_CATEGORY_Q, {
      id: category_id,
      moveToCategoryId: null,
    });
    assertNoPayloadErrors(d.deleteCategory, 'DeleteCategory');
    return { deleted: d.deleteCategory.deleted ?? true, category_id };
  },
});
