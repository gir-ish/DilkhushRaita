-- CreateTable
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "codEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onlineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "codMaxOrderValue" REAL,
    "codFrom" TEXT,
    "codTo" TEXT,
    "updatedAt" DATETIME NOT NULL
);

