import { z } from 'zod';
import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GET_TAGS_Q, type GetTagsData } from '../../monarch/ops/tags.ts';

export const GetTags = defineTool({
  name: 'GetTags',
  title: 'List tags',
  description: `List the user's transaction tags.

Tags are a way to group transactions across categories (e.g. "vacation",
"tax-deductible"). Returns each tag's id, name, color, and how many
transactions currently use it. Pass a tag \`id\` to the write tools that take
\`tag_ids\` (and to UpdateTag / DeleteTag).`,
  readOnly: true,
  idempotent: true,
  input: {
    search: z.string().nullable().optional().describe('optional case-insensitive substring filter on tag name.'),
  },
  handler: async ({ search }) => {
    const c = await getMonarch();
    const d = await c.query<GetTagsData>(GET_TAGS_Q, { search: search ?? null });
    return {
      tags: d.householdTransactionTags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        transaction_count: t.transactionCount,
      })),
    };
  },
});
