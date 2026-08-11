-- AlterTable
ALTER TABLE "User" ADD COLUMN "pinHash" TEXT;

-- CreateTable
CREATE TABLE "StaffDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffDevice_tokenHash_key" ON "StaffDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffDevice_userId_idx" ON "StaffDevice"("userId");
