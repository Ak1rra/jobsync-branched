export interface JobDetails {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate?: string;
  salary?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  // ISO date the posting closes to applications, when the source reports one
  // (USAJOBS). Absent => the persistence mapper's default due-date window.
  dueDate?: string;
}

export type ScraperError =
  | { type: "blocked"; reason: string }
  | { type: "rate_limited"; retryAfter?: number }
  | { type: "network"; message: string }
  | { type: "parse"; message: string };

export type ScraperResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScraperError };
