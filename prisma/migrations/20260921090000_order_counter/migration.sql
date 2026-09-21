-- CreateTable
CREATE TABLE "OrderCounter" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

