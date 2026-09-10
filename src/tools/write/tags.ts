import { z } from 'zod';
import { defineTool, optStr, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors } from '../lib/mutations.ts';
import { CREATE_TAG_Q, UPDATE_TAG_Q, DELETE_TAG_Q, GET_TAGS_Q, type GetTagsData, type Tag } from '../../monarch/ops/tags.ts';

type TagPayload = { tag: Tag | null; errors: Array<{ message: string }> | null };
const PALETTE = ['#1E5AC3', '#32AAF0', '#19D2A5', '#F0A830', '#E05A5A', '#9B59B6'];

export const CreateTag = defineTool({
  name: 'CreateTag',
  title: 'Create tag',
  description: 'Create a tag.',
  readOnly: false,
  destructive: false,
  input: {
    name: z.string().describe('Tag name. Must be unique within the household.'),
    color: optStr.describe("Optional hex color (e.g. '#abcdef')."),
  },
  handler: async ({ name, color }) => {
    const c = await getMonarch();
    const d = await c.query<{ createTransactionTag: TagPayload }>(CREATE_TAG_Q, {
      input: { name, color: color ?? PALETTE[name.length % PALETTE.length] },
    });
    assertNoPayloadErrors(d.createTransactionTag, 'CreateTag');
    const t = d.createTransactionTag.tag!;
    return { tag_id: t.id, name: t.name, color: t.color };
  },
});

export const UpdateTag = defineTool({
  name: 'UpdateTag',
  title: 'Update tag',
  description: 'Rename a tag and/or change its color. Pass only the fields you want to change.',
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: { tag_id: z.string(), name: optStr, color: optStr },
  handler: async ({ tag_id, name, color }) => {
    const c = await getMonarch();
    // The mutation requires both name and color, so read the current values first.
    const current = (await c.query<GetTagsData>(GET_TAGS_Q, { search: null })).householdTransactionTags.find((t) => t.id === tag_id);
    if (!current) throw new ToolInputError(`tag ${tag_id} not found`);
    const d = await c.query<{ updateTransactionTag: TagPayload }>(UPDATE_TAG_Q, {
      input: { id: tag_id, name: name ?? current.name, color: color ?? current.color },
    });
    assertNoPayloadErrors(d.updateTransactionTag, 'UpdateTag');
    const t = d.updateTransactionTag.tag!;
    return { tag_id: t.id, name: t.name, color: t.color };
  },
});

export const DeleteTag = defineTool({
  name: 'DeleteTag',
  title: 'Delete tag',
  description: "Delete a tag. Removes it from any transactions it's attached to.",
  readOnly: false,
  destructive: true,
  input: { tag_id: z.string() },
  handler: async ({ tag_id }) => {
    const c = await getMonarch();
    const d = await c.query<{ deleteTransactionTag: { errors: Array<{ message: string }> | null } }>(DELETE_TAG_Q, { tagId: tag_id });
    assertNoPayloadErrors(d.deleteTransactionTag, 'DeleteTag');
    return { deleted: true, tag_id };
  },
});
