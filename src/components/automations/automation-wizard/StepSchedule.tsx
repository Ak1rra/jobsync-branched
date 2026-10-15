"use client";

import type { UseFormReturn } from "react-hook-form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { CreateAutomationInput } from "@/models/automation.schema";
import { WEEKDAYS } from "@/lib/scraper/schedule";
import { DEFAULT_WEEKLY_DAY, HOURS } from "./wizardConfig";

export function StepSchedule({
  form,
  takenHours,
}: {
  form: UseFormReturn<CreateAutomationInput>;
  takenHours: Set<number>;
}) {
  const weekly = form.watch("scheduleFrequency") === "weekly";

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="scheduleFrequency"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Run Frequency</FormLabel>
            <RadioGroup
              className="flex gap-6"
              value={field.value ?? "daily"}
              onValueChange={(val) => {
                field.onChange(val);
                form.setValue(
                  "scheduleDayOfWeek",
                  val === "weekly"
                    ? (form.getValues("scheduleDayOfWeek") ?? DEFAULT_WEEKLY_DAY)
                    : null,
                );
              }}
            >
              <FormItem className="flex items-center space-x-2 space-y-0">
                <FormControl>
                  <RadioGroupItem value="daily" id="schedule-daily" />
                </FormControl>
                <FormLabel htmlFor="schedule-daily" className="font-normal">
                  Daily
                </FormLabel>
              </FormItem>
              <FormItem className="flex items-center space-x-2 space-y-0">
                <FormControl>
                  <RadioGroupItem value="weekly" id="schedule-weekly" />
                </FormControl>
                <FormLabel htmlFor="schedule-weekly" className="font-normal">
                  Weekly
                </FormLabel>
              </FormItem>
            </RadioGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      {weekly && (
        <FormField
          control={form.control}
          name="scheduleDayOfWeek"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Day of the Week</FormLabel>
              <Select
                onValueChange={(val) => field.onChange(parseInt(val))}
                value={(field.value ?? DEFAULT_WEEKLY_DAY).toString()}
              >
                <FormControl>
                  <SelectTrigger aria-label="Day of the week">
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {WEEKDAYS.map((day) => (
                    <SelectItem key={day.value} value={day.value.toString()}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="scheduleHour"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{weekly ? "Weekly" : "Daily"} Run Time</FormLabel>
            <Select
              onValueChange={(val) => {
                field.onChange(parseInt(val));
                form.clearErrors("scheduleHour");
              }}
              value={field.value.toString()}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {HOURS.map((hour) => (
                  <SelectItem key={hour.value} value={hour.value.toString()}>
                    {hour.label}
                    {takenHours.has(hour.value) && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        In use
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              The automation will run{" "}
              {weekly ? "once a week" : "daily"} at this time (server timezone)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
