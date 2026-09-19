-- CreateTable
CREATE TABLE "SmsSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "pointsSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pointsSmsMinOrder" REAL NOT NULL DEFAULT 1000,
    "updatedAt" DATETIME NOT NULL
);

