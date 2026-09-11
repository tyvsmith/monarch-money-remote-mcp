import { z } from 'zod';
import { jsonArg, ToolInputError } from '../registry.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import { GET_HOUSEHOLD_Q, type HouseholdData } from '../../monarch/ops/household.ts';

const ownershipSchema = z.object({
  scope: z.enum(['household', 'user']).optional(),
  user: z.string().optional(),
  jointly_owned_setting: z.boolean().nullable().optional(),
});
export type OwnershipArg = z.infer<typeof ownershipSchema>;
export interface OwnershipSetInput {
  userIds: string[];
  includeJointlyOwned: boolean;
}
export interface Member {
  id: string;
  name: string;
  displayName: string;
}

export function parseOwnership(raw: string | null | undefined): OwnershipArg {
  return jsonArg(raw, ownershipSchema, 'ownership');
}

export function ownershipToSet(o: OwnershipArg, members: Member[], selfId: string): OwnershipSetInput | undefined {
  if (o.scope !== 'user') return undefined;
  const who = (o.user ?? 'self').toLowerCase();
  const id =
    who === 'self'
      ? selfId
      : members.find(
          (m) => m.displayName.toLowerCase() === who || m.name.toLowerCase() === who || m.name.toLowerCase().startsWith(who),
        )?.id;
  if (!id) throw new ToolInputError(`ownership.user "${o.user}" is not a household member`);
  return { userIds: [id], includeJointlyOwned: o.jointly_owned_setting ?? true };
}

/** Parse the official ownership JSON and, only when it scopes to a user, resolve it against the household. */
export async function resolveOwnershipSet(c: MonarchClient, raw: string | null | undefined): Promise<OwnershipSetInput | undefined> {
  const own = parseOwnership(raw);
  if (own.scope !== 'user') return undefined;
  const h = await c.query<HouseholdData>(GET_HOUSEHOLD_Q);
  return ownershipToSet(own, h.myHousehold.users, h.me.id);
}
