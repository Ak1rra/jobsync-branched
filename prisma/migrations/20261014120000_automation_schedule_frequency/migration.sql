-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "scheduleDayOfWeek" INTEGER;
ALTER TABLE "Automation" ADD COLUMN "scheduleFrequency" TEXT NOT NULL DEFAULT 'daily';
