import { db } from "./db";

export async function audit(
  actor: { uid: string; name?: string } | null,
  action: string,
  entity: string,
  entityId?: string,
  detail?: unknown
) {
  try {
    await db.auditLog.create({
      data: {
        actorId: actor?.uid,
        actorName: actor?.name,
        action,
        entity,
        entityId,
        detail: detail ? JSON.stringify(detail) : null,
      },
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
