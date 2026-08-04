-- AlterTable
ALTER TABLE "Order" ADD COLUMN "tableNo" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "variantName" TEXT,
    "addOnsJson" TEXT NOT NULL DEFAULT '[]',
    "unitPrice" REAL NOT NULL,
    "qty" INTEGER NOT NULL,
    "lineTotal" REAL NOT NULL,
    "instructions" TEXT,
    "round" INTEGER NOT NULL DEFAULT 1,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("addOnsJson", "id", "instructions", "lineTotal", "menuItemId", "nameSnapshot", "orderId", "qty", "unitPrice", "variantName") SELECT "addOnsJson", "id", "instructions", "lineTotal", "menuItemId", "nameSnapshot", "orderId", "qty", "unitPrice", "variantName" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
