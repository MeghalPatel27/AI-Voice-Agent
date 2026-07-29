-- CreateEnum
CREATE TYPE "ChannelEndpointChannel" AS ENUM ('VOICE');

-- CreateEnum
CREATE TYPE "ChannelEndpointProvider" AS ENUM ('TWILIO');

-- CreateEnum
CREATE TYPE "ChannelEndpointStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "ChannelEndpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "ChannelEndpointChannel" NOT NULL,
    "provider" "ChannelEndpointProvider" NOT NULL,
    "routingKey" TEXT NOT NULL,
    "status" "ChannelEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelEndpoint_provider_routingKey_key" ON "ChannelEndpoint"("provider", "routingKey");

-- CreateIndex
CREATE INDEX "ChannelEndpoint_companyId_idx" ON "ChannelEndpoint"("companyId");

-- CreateIndex
CREATE INDEX "ChannelEndpoint_channel_provider_status_idx" ON "ChannelEndpoint"("channel", "provider", "status");

-- AddForeignKey
ALTER TABLE "ChannelEndpoint" ADD CONSTRAINT "ChannelEndpoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
