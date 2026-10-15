"use server";

import db from "@/lib/db";
import { requireUser } from "../shared";
import { calculateNextRunAtFor } from "@/lib/scraper/schedule";
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from "@/models/automation.schema";
import type { AutomationWithResume } from "@/models/automation.model";
import { isRetiredBoard } from "@/models/automation.model";
import { APP_CONSTANTS } from "@/lib/constants";
import { syncSchedulerState } from "@/lib/scheduler";
import { formatError } from "./shared";

// Two automations clash when they can fire in the same hour on the same day:
// same hour, and either is daily or both are weekly on the same weekday.
async function findScheduleClash(
  userId: string,
  schedule: {
    scheduleHour: number;
    scheduleFrequency: string;
    scheduleDayOfWeek: number | null;
  },
  excludeId?: string,
) {
  return db.automation.findFirst({
    where: {
      userId,
      scheduleHour: schedule.scheduleHour,
      ...(schedule.scheduleFrequency === "weekly" && {
        OR: [
          { scheduleFrequency: "daily" },
          {
            scheduleFrequency: "weekly",
            scheduleDayOfWeek: schedule.scheduleDayOfWeek,
          },
        ],
      }),
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });
}

function clashMessage(scheduleHour: number) {
  return `Another automation already runs at ${scheduleHour
    .toString()
    .padStart(2, "0")}:00. Please choose a different time.`;
}

export async function createAutomation(input: CreateAutomationInput): Promise<{
  success: boolean;
  data?: AutomationWithResume;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const validated = CreateAutomationSchema.parse(input);

    const count = await db.automation.count({ where: { userId: user.id } });
    if (count >= APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER) {
      return {
        success: false,
        message: `Maximum of ${APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER} automations allowed per user`,
      };
    }

    const scheduleFrequency = validated.scheduleFrequency ?? "daily";
    const scheduleDayOfWeek =
      scheduleFrequency === "weekly" ? (validated.scheduleDayOfWeek ?? null) : null;

    const scheduleClash = await findScheduleClash(user.id, {
      scheduleHour: validated.scheduleHour,
      scheduleFrequency,
      scheduleDayOfWeek,
    });
    if (scheduleClash) {
      return { success: false, message: clashMessage(validated.scheduleHour) };
    }

    const resume = await db.resume.findFirst({
      where: {
        id: validated.resumeId,
        profile: { userId: user.id },
      },
    });

    if (!resume) {
      return {
        success: false,
        message: "Resume not found or doesn't belong to you",
      };
    }

    const nextRunAt = calculateNextRunAtFor({
      scheduleHour: validated.scheduleHour,
      scheduleFrequency,
      scheduleDayOfWeek,
    });

    const automation = await db.automation.create({
      data: {
        userId: user.id,
        name: validated.name,
        jobBoard: validated.jobBoard,
        keywords: validated.keywords ?? "",
        location: validated.location ?? "",
        sourceConfig: validated.sourceConfig
          ? JSON.stringify(validated.sourceConfig)
          : null,
        resumeId: validated.resumeId,
        matchThreshold: validated.matchThreshold,
        scheduleHour: validated.scheduleHour,
        scheduleFrequency,
        scheduleDayOfWeek,
        nextRunAt,
        status: "active",
      },
      include: {
        resume: {
          select: { id: true, title: true },
        },
      },
    });

    await syncSchedulerState();

    return {
      success: true,
      data: automation as unknown as AutomationWithResume,
    };
  } catch (error) {
    return formatError(error, "Failed to create automation");
  }
}

export async function updateAutomation(
  id: string,
  input: UpdateAutomationInput,
): Promise<{
  success: boolean;
  data?: AutomationWithResume;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const validated = UpdateAutomationSchema.parse(input);

    const existing = await db.automation.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return { success: false, message: "Automation not found" };
    }

    if (isRetiredBoard(existing.jobBoard)) {
      return {
        success: false,
        message: `The ${existing.jobBoard} job board has been removed. This automation can only be deleted.`,
      };
    }

    if (validated.resumeId) {
      const resume = await db.resume.findFirst({
        where: {
          id: validated.resumeId,
          profile: { userId: user.id },
        },
      });
      if (!resume) {
        return {
          success: false,
          message: "Resume not found or doesn't belong to you",
        };
      }
    }

    const updateData: Record<string, unknown> = { ...validated };

    // sourceConfig is a parsed object in the validated input; the column is a
    // JSON string. Coalesce the legacy columns for greenhouse automations.
    if (validated.sourceConfig !== undefined) {
      updateData.sourceConfig = JSON.stringify(validated.sourceConfig);
    }
    if (validated.jobBoard) {
      updateData.keywords = validated.keywords ?? "";
      updateData.location = validated.location ?? "";
    }

    // Any change to the cadence moves the next run. Fields the caller left out
    // fall back to the stored schedule.
    if (
      validated.scheduleHour !== undefined ||
      validated.scheduleFrequency !== undefined ||
      validated.scheduleDayOfWeek !== undefined
    ) {
      const scheduleHour = validated.scheduleHour ?? existing.scheduleHour;
      const scheduleFrequency =
        validated.scheduleFrequency ?? existing.scheduleFrequency ?? "daily";
      const scheduleDayOfWeek =
        scheduleFrequency === "weekly"
          ? (validated.scheduleDayOfWeek ?? existing.scheduleDayOfWeek ?? null)
          : null;
      if (scheduleFrequency === "weekly" && scheduleDayOfWeek === null) {
        return { success: false, message: "Choose a day of the week" };
      }
      const scheduleClash = await findScheduleClash(
        user.id,
        { scheduleHour, scheduleFrequency, scheduleDayOfWeek },
        id,
      );
      if (scheduleClash) {
        return { success: false, message: clashMessage(scheduleHour) };
      }
      updateData.scheduleFrequency = scheduleFrequency;
      updateData.scheduleDayOfWeek = scheduleDayOfWeek;
      updateData.nextRunAt = calculateNextRunAtFor({
        scheduleHour,
        scheduleFrequency,
        scheduleDayOfWeek,
      });
    }

    const automation = await db.automation.update({
      where: { id },
      data: updateData,
      include: {
        resume: {
          select: { id: true, title: true },
        },
      },
    });

    return {
      success: true,
      data: automation as unknown as AutomationWithResume,
    };
  } catch (error) {
    return formatError(error, "Failed to update automation");
  }
}

export async function deleteAutomation(id: string): Promise<{
  success: boolean;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const automation = await db.automation.findFirst({
      where: { id, userId: user.id },
    });

    if (!automation) {
      return { success: false, message: "Automation not found" };
    }

    await db.automation.delete({ where: { id } });

    await syncSchedulerState();

    return { success: true };
  } catch (error) {
    return formatError(error, "Failed to delete automation");
  }
}

export async function pauseAutomation(id: string): Promise<{
  success: boolean;
  data?: AutomationWithResume;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const automation = await db.automation.findFirst({
      where: { id, userId: user.id },
    });

    if (!automation) {
      return { success: false, message: "Automation not found" };
    }

    const updated = await db.automation.update({
      where: { id },
      data: {
        status: "paused",
        nextRunAt: null,
      },
      include: {
        resume: {
          select: { id: true, title: true },
        },
      },
    });

    await syncSchedulerState();

    return {
      success: true,
      data: updated as unknown as AutomationWithResume,
    };
  } catch (error) {
    return formatError(error, "Failed to pause automation");
  }
}

export async function resumeAutomation(id: string): Promise<{
  success: boolean;
  data?: AutomationWithResume;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const automation = await db.automation.findFirst({
      where: { id, userId: user.id },
    });

    if (!automation) {
      return { success: false, message: "Automation not found" };
    }

    const nextRunAt = calculateNextRunAtFor(automation);

    const updated = await db.automation.update({
      where: { id },
      data: {
        status: "active",
        nextRunAt,
      },
      include: {
        resume: {
          select: { id: true, title: true },
        },
      },
    });

    await syncSchedulerState();

    return {
      success: true,
      data: updated as unknown as AutomationWithResume,
    };
  } catch (error) {
    return formatError(error, "Failed to resume automation");
  }
}
