-- CreateTable
CREATE TABLE "KhataSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "yellowAbove" REAL NOT NULL DEFAULT 0,
    "redAbove" REAL NOT NULL DEFAULT 1000,
    "updatedAt" DATETIME NOT NULL
);

