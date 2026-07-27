/*
  Warnings:

  - The `industry` column on the `Company` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('HOSPITAL', 'CLINIC', 'HOTEL', 'RESTAURANT', 'REAL_ESTATE', 'OTHER');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "industry",
ADD COLUMN     "industry" "Industry" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessHours" TEXT,
    "whatsappNumber" TEXT,
    "callForwardingNumber" TEXT,
    "escalationPhone" TEXT,
    "handoverRules" TEXT,
    "aiTone" TEXT,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_webhookSecret_key" ON "CompanySettings"("webhookSecret");

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
