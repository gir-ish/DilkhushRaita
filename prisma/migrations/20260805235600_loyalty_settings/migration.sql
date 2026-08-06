-- CreateTable
CREATE TABLE "LoyaltySettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "pointsPer10Rupees" REAL NOT NULL DEFAULT 1,
    "pointValueRupees" REAL NOT NULL DEFAULT 0.5,
    "minPointsToRedeem" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" DATETIME NOT NULL
);
