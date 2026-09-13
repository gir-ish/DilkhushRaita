-- CreateTable
CREATE TABLE "KhataEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "orderId" TEXT,
    "branchId" TEXT,
    "method" TEXT,
    "note" TEXT,
    "staffId" TEXT,
    "staffName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KhataEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KhataEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KhataEntry_userId_createdAt_idx" ON "KhataEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "KhataEntry_orderId_idx" ON "KhataEntry"("orderId");

