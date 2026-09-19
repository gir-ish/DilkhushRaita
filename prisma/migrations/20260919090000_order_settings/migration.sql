-- CreateTable
CREATE TABLE "OrderSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "maxQtyPerItem" INTEGER NOT NULL DEFAULT 20,
    "maxItemsPerOrder" INTEGER NOT NULL DEFAULT 50,
    "updatedAt" DATETIME NOT NULL
);

