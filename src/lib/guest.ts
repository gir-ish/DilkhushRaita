import { db } from "./db";

/**
 * The walk-in who does not give a number.
 *
 * Most counter customers hand over a phone number and get points, an SMS and a
 * history for it. Some just want two parathas and their change, and holding up
 * the queue to argue about a number is worse than losing the record — so the
 * bill goes to one shared guest account instead.
 *
 * One fixed row, not one per order: a new user for every walk-in would bury
 * the real customers in the customer list, the khata screen and every count
 * built on top of them. The id is written down here rather than generated so
 * that guest orders can always be recognised again — including by reports that
 * should leave them out.
 */
export const GUEST_USER_ID = "dk-guest-walk-in";
export const GUEST_NAME = "Guest";

export function isGuest(userId: string | null | undefined): boolean {
  return userId === GUEST_USER_ID;
}

/** The guest account, created the first time a guest bill is raised. */
export async function guestUserId(): Promise<string> {
  await db.user.upsert({
    where: { id: GUEST_USER_ID },
    update: {},
    create: {
      id: GUEST_USER_ID,
      // No phone: there is nobody to text, and a blank keeps it out of every
      // campaign and every "find the customer" search by number.
      phone: null,
      name: GUEST_NAME,
      role: "CUSTOMER",
      profile: { create: { referralCode: "DKGUEST" } },
      metrics: { create: {} },
    },
  });
  return GUEST_USER_ID;
}
