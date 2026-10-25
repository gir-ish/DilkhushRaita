import type { Role } from "./constants";

/**
 * Who may charge something other than the menu price.
 *
 * Repricing a line is giving food away, or charging more than the board says.
 * Both are an owner's decision about their own shop, not a judgement call for
 * whoever happens to be on the till at nine on a Friday — a cashier can
 * already take a recorded discount off a bill, which covers the everyday
 * kindness without putting the menu itself up for negotiation.
 *
 * Its own file because the counter asks in three places — a new order, a
 * round added to a table, items added at handover — and three copies of a
 * rule about money is two too many.
 */
export function canRepriceLines(role: string): boolean {
  return (["OWNER", "BRANCH_MANAGER"] satisfies Role[]).includes(role as never);
}
