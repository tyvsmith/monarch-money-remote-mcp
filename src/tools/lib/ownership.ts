import { z } from 'zod';
import { jsonArg } from '../registry.ts';

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
  if (!id) throw new Error(`ownership.user "${o.user}" is not a household member`);
  return { userIds: [id], includeJointlyOwned: o.jointly_owned_setting ?? true };
}
