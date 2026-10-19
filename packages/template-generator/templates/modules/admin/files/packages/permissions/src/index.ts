import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";

export type Action = "manage" | "access" | "read" | "create" | "update" | "delete";

/**
 * Permission subjects. Modules add theirs through declaration merging:
 *
 *   declare module "@app/permissions" {
 *     interface SubjectMap {
 *       Order: true;
 *     }
 *   }
 */
export interface SubjectMap {
  all: true;
  Admin: true;
  User: true;
}

export type Subject = keyof SubjectMap;

export type AppAbility = MongoAbility<[Action, Subject]>;

export type Actor = { id: string; role?: string | null };

/** Rules per role. Admins manage everything; extend this for finer-grained roles. */
export function defineAbilityFor(actor: Actor | null | undefined): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  if (actor?.role === "admin") can("manage", "all");
  return build();
}
