"use client";

import { useState, type KeyboardEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  USAJOBS_CLEARANCE_CODES,
  USAJOBS_HIRING_PATHS,
  USAJOBS_MAX_LOCATIONS,
  USAJOBS_MAX_TITLES,
  USAJOBS_SCHEDULE_CODES,
  USAJOBS_SORT_DIRECTIONS,
  USAJOBS_SORT_FIELDS,
  USAJOBS_WHO_MAY_APPLY,
  type UsajobsSortDirection,
  type UsajobsSortField,
  type UsajobsWhoMayApply,
} from "@/lib/scraper/usajobs/types";
import { StrictLocationToggle } from "./TargetingFields";
import type { UsajobsConfigValue } from "./types";
import { hasSecondaryUsajobsFilters } from "./usajobsConfig";
import {
  CLEARANCE_LABELS,
  HIRING_PATH_LABELS,
  PAY_GRADES,
  SCHEDULE_LABELS,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  WHO_MAY_APPLY_LABELS,
} from "./usajobsOptions";

// Radix Select cannot hold "" as an item value, so "no preference" is a
// sentinel that maps back to an absent field.
const ANY = "__any";

const MAX_LIST_ITEMS = 10; // mirrors the schema's per-list cap

interface StringListInputProps {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  // Returns the normalized value, or null when it is not acceptable.
  normalize?: (raw: string) => string | null;
  invalidMessage?: string;
  maxItems?: number;
  // Entries that may themselves contain commas (a title, "City, State") are
  // added by Enter or blur only; comma-separated lists also split on ','.
  splitOnComma?: boolean;
}

// Free-text chip list (Enter or comma adds). Entries are checked against the
// same rules the schema enforces, so a bad code is rejected where it is typed.
function StringListInput({
  id,
  label,
  description,
  placeholder,
  values,
  onChange,
  normalize = (raw) => raw,
  invalidMessage,
  maxItems = MAX_LIST_ITEMS,
  splitOnComma = true,
}: StringListInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = values.length >= maxItems;

  const commit = () => {
    const parts = (splitOnComma ? input.split(",") : [input])
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const part of parts) {
      const normalized = normalize(part);
      if (normalized === null) {
        setError(invalidMessage ?? `"${part}" is not valid.`);
        return;
      }
      if (next.length >= maxItems) break;
      if (!next.some((v) => v.toLowerCase() === normalized.toLowerCase())) {
        next.push(normalized);
      }
    }
    setError(null);
    setInput("");
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || (splitOnComma && e.key === ",")) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        placeholder={full ? `Up to ${maxItems} entries` : placeholder}
        value={input}
        disabled={full}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

interface ToggleChipsProps<T extends string | number> {
  label: string;
  description?: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}

// Multi-select as a wrap of toggle buttons (the form has no checkbox
// component; Toggle gives aria-pressed semantics).
function ToggleChips<T extends string | number>({
  label,
  description,
  options,
  selected,
  onChange,
}: ToggleChipsProps<T>) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Toggle
            key={o.value}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            pressed={selected.includes(o.value)}
            onPressedChange={(on) =>
              onChange(
                on
                  ? [...selected, o.value]
                  : selected.filter((v) => v !== o.value),
              )
            }
          >
            {o.label}
          </Toggle>
        ))}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

interface OptionSelectProps {
  id: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  anyLabel: string;
  onChange: (next: string | undefined) => void;
  description?: string;
}

function OptionSelect({
  id,
  label,
  value,
  options,
  anyLabel,
  onChange,
  description,
}: OptionSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ANY}
        onValueChange={(v) => onChange(v === ANY ? undefined : v)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled,
  description,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        placeholder={placeholder}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

const upperCode = (raw: string) =>
  /^[A-Za-z0-9]{1,10}$/.test(raw) ? raw.toUpperCase() : null;
const seriesCode = (raw: string) => (/^\d{4}$/.test(raw) ? raw : null);
const locationText = (raw: string) =>
  raw.includes(";") || raw.length > 100 ? null : raw;
const titleText = (raw: string) => (raw.length > 100 ? null : raw);

const toOptions = <T extends string | number>(
  values: readonly T[],
  labels: Record<T, string>,
) => values.map((v) => ({ value: v, label: labels[v] }));

interface UsajobsSearchFieldsProps {
  value: UsajobsConfigValue;
  onChange: (next: UsajobsConfigValue) => void;
}

// The server-side half of a USAJOBS automation: everything here becomes a
// parameter of the Search API request. The position titles and locations are
// the shared targetTitles / locations (one field each): they are both the
// search and the ranking terms. The remaining ranking fields (keywords, top-K,
// ...) are rendered separately by the wizard step.
export function UsajobsSearchFields({
  value,
  onChange,
}: UsajobsSearchFieldsProps) {
  const set = (patch: Partial<UsajobsConfigValue>) =>
    onChange({ ...value, ...patch });
  const hasLocation = (value.locations?.length ?? 0) > 0;
  const [moreOpen, setMoreOpen] = useState(() =>
    hasSecondaryUsajobsFilters(value),
  );

  const remoteValue =
    value.remoteIndicator === undefined
      ? undefined
      : value.remoteIndicator
        ? "remote"
        : "exclude";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="usajobs-keyword">Keyword</Label>
        <Input
          id="usajobs-keyword"
          placeholder="e.g., data scientist"
          value={value.keyword ?? ""}
          onChange={(e) => set({ keyword: e.target.value })}
        />
        <p className="text-sm text-muted-foreground">
          Searched by USAJOBS across announcement text. Add at least one of
          keyword, position title, location, agency or series.
        </p>
      </div>

      <StringListInput
        id="usajobs-position-title"
        label="Position titles"
        placeholder="e.g., IT Specialist"
        description={`Matched against the announcement's position title, and used to rank results. Press Enter to add each one (up to ${USAJOBS_MAX_TITLES}); each title is searched separately and the results are merged.`}
        values={value.targetTitles ?? []}
        onChange={(next) => set({ targetTitles: next })}
        normalize={titleText}
        invalidMessage="Titles cannot exceed 100 characters."
        maxItems={USAJOBS_MAX_TITLES}
        splitOnComma={false}
      />

      <StringListInput
        id="usajobs-location-name"
        label="Locations"
        placeholder="e.g., Washington, District of Columbia"
        description={`Searched on USAJOBS and used to rank results. Press Enter to add each one (up to ${USAJOBS_MAX_LOCATIONS}).`}
        values={value.locations ?? []}
        onChange={(next) => set({ locations: next })}
        normalize={locationText}
        invalidMessage="Locations cannot contain ';' or exceed 100 characters."
        maxItems={USAJOBS_MAX_LOCATIONS}
        splitOnComma={false}
      />

      <NumberField
        id="usajobs-radius"
        label="Radius"
        value={value.radius}
        min={1}
        max={500}
        placeholder="Optional"
        disabled={!hasLocation}
        onChange={(next) => set({ radius: next })}
        description="Search distance around the locations. Requires a location."
      />

      <StrictLocationToggle value={value} onChange={onChange} />

      <StringListInput
        id="usajobs-organization"
        label="Agency codes"
        placeholder="e.g., AF, NN"
        description="USAJOBS agency (sub-element) codes. Press Enter or comma to add."
        values={value.organization ?? []}
        onChange={(next) => set({ organization: next })}
        normalize={upperCode}
        invalidMessage="Agency codes are 1-10 letters or digits."
      />

      <StringListInput
        id="usajobs-job-category"
        label="Occupational series codes"
        placeholder="e.g., 2210"
        description="Four-digit series codes, such as 2210 (IT Management). Press Enter or comma to add."
        values={value.jobCategoryCode ?? []}
        onChange={(next) => set({ jobCategoryCode: next })}
        normalize={seriesCode}
        invalidMessage="Series codes are exactly four digits."
      />

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium"
          >
            More filters
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                moreOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-5">
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="usajobs-salary-min"
              label="Minimum salary"
              value={value.remunerationMinimumAmount}
              min={0}
              max={1000000}
              placeholder="Annual, USD"
              onChange={(next) => set({ remunerationMinimumAmount: next })}
            />
            <NumberField
              id="usajobs-salary-max"
              label="Maximum salary"
              value={value.remunerationMaximumAmount}
              min={0}
              max={1000000}
              placeholder="Annual, USD"
              onChange={(next) => set({ remunerationMaximumAmount: next })}
            />
            <OptionSelect
              id="usajobs-grade-low"
              label="Pay grade (low)"
              value={value.payGradeLow}
              anyLabel="Any"
              options={PAY_GRADES.map((g) => ({ value: g, label: g }))}
              onChange={(next) => set({ payGradeLow: next })}
            />
            <OptionSelect
              id="usajobs-grade-high"
              label="Pay grade (high)"
              value={value.payGradeHigh}
              anyLabel="Any"
              options={PAY_GRADES.map((g) => ({ value: g, label: g }))}
              onChange={(next) => set({ payGradeHigh: next })}
            />
          </div>
          <p className="-mt-3 text-sm text-muted-foreground">
            Salary filters are re-checked against each announcement&apos;s
            annual range after the search.
          </p>

          <ToggleChips
            label="Hiring path"
            description="Who the announcement is open to."
            options={toOptions(USAJOBS_HIRING_PATHS, HIRING_PATH_LABELS)}
            selected={value.hiringPath ?? []}
            onChange={(next) => set({ hiringPath: next })}
          />

          <OptionSelect
            id="usajobs-who-may-apply"
            label="Who may apply"
            value={value.whoMayApply}
            anyLabel="Any"
            options={USAJOBS_WHO_MAY_APPLY.map((v: UsajobsWhoMayApply) => ({
              value: v,
              label: WHO_MAY_APPLY_LABELS[v],
            }))}
            onChange={(next) =>
              set({ whoMayApply: next as UsajobsWhoMayApply | undefined })
            }
            description='"Status" and "All" additionally require specific authorization from OPM.'
          />

          <OptionSelect
            id="usajobs-remote"
            label="Remote"
            value={remoteValue}
            anyLabel="Any"
            options={[
              { value: "remote", label: "Remote only" },
              { value: "exclude", label: "Exclude remote" },
            ]}
            onChange={(next) =>
              set({
                remoteIndicator:
                  next === undefined ? undefined : next === "remote",
              })
            }
          />

          <ToggleChips
            label="Schedule"
            options={toOptions(USAJOBS_SCHEDULE_CODES, SCHEDULE_LABELS)}
            selected={value.positionScheduleTypeCode ?? []}
            onChange={(next) => set({ positionScheduleTypeCode: next })}
          />

          <StringListInput
            id="usajobs-offering-type"
            label="Appointment type codes"
            placeholder="e.g., 15317"
            description="Work-type codes from the USAJOBS Code List API (position offering type). Press Enter or comma to add."
            values={value.positionOfferingTypeCode ?? []}
            onChange={(next) => set({ positionOfferingTypeCode: next })}
            normalize={upperCode}
            invalidMessage="Codes are 1-10 letters or digits."
          />

          <ToggleChips
            label="Security clearance"
            options={toOptions(USAJOBS_CLEARANCE_CODES, CLEARANCE_LABELS)}
            selected={value.securityClearanceRequired ?? []}
            onChange={(next) => set({ securityClearanceRequired: next })}
          />

          <NumberField
            id="usajobs-date-posted"
            label="Posted within (days)"
            value={value.datePosted}
            min={0}
            max={60}
            placeholder="Any time"
            onChange={(next) => set({ datePosted: next })}
            description="0-60 days."
          />

          <div className="grid grid-cols-2 gap-4">
            <OptionSelect
              id="usajobs-sort-field"
              label="Sort by"
              value={value.sortField}
              anyLabel="Default"
              options={USAJOBS_SORT_FIELDS.map((f: UsajobsSortField) => ({
                value: f,
                label: SORT_FIELD_LABELS[f],
              }))}
              onChange={(next) =>
                set({ sortField: next as UsajobsSortField | undefined })
              }
            />
            <OptionSelect
              id="usajobs-sort-direction"
              label="Direction"
              value={value.sortDirection}
              anyLabel="Default"
              options={USAJOBS_SORT_DIRECTIONS.map(
                (d: UsajobsSortDirection) => ({
                  value: d,
                  label: SORT_DIRECTION_LABELS[d],
                }),
              )}
              onChange={(next) =>
                set({ sortDirection: next as UsajobsSortDirection | undefined })
              }
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
