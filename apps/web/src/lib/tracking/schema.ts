/**
 * A strict schema for a TrackingPlan coming back from a browser (POST /api/onboarding/restore). The browser's
 * copy is untrusted: bounded strings and arrays, known categories and dashboard kinds, nothing extra.
 */
import { z } from "zod";
import type { TrackingPlan } from "@/lib/contracts";

const text = (max: number) => z.string().max(max);
const iso = z.string().max(40).refine((s) => Number.isFinite(Date.parse(s)), "Not a date");

export const TrackingEventSchema = z.strictObject({
  name: z.string().regex(/^\$?[a-z0-9_]{1,60}$/),
  label: text(80),
  why: text(300),
  category: z.enum(["automatic", "funnel", "goal", "revenue"]),
  automatic: z.boolean(),
  properties: z.array(z.string().regex(/^\$?[a-z0-9_]{1,40}$/)).max(12).optional(),
  snippet: text(400).optional(),
  enabled: z.boolean(),
  fromPrompt: z.boolean().optional(),
});

export const DashboardSpecSchema = z.strictObject({
  id: z.string().regex(/^[\w.-]{1,80}$/),
  kind: z.enum([
    "kpis",
    "funnel",
    "sources",
    "humans-agents",
    "heatmap",
    "experiments",
    "revenue",
    "events",
    "devices",
    "trend",
    "number",
    "retention",
    "paths",
    "lifecycle",
    "breakdown",
    "time_to_convert",
    "hourly",
  ]),
  title: text(120),
  why: text(300),
  events: z.array(z.string().max(60)).max(24).optional(),
  custom: z.boolean().optional(),
  breakdown: z.enum(["visitor_kind", "device", "source", "page"]).optional(),
  property: z.string().regex(/^\$?[\w.-]{1,60}$/).optional(),
  interval: z.enum(["minute", "hour", "day"]).optional(),
  display: z.enum(["line", "bars"]).optional(),
  period: z.enum(["hour", "today", "week"]).optional(),
  from: z.string().max(120).optional(),
});

export const TrackingPlanSchema = z.strictObject({
  site: z.string().regex(/^[\w.-]{1,64}$/),
  repo: text(200).optional(),
  siteUrl: z.url({ protocol: /^https?$/ }).max(300).optional(),
  framework: text(120).optional(),
  prompt: text(1000).optional(),
  whop: text(120).optional(),
  goals: z.array(text(40)).max(20).optional(),
  repoRead: z.boolean().optional(),
  existingAnalytics: z.array(text(60)).max(20).optional(),
  events: z.array(TrackingEventSchema).min(1).max(60),
  dashboards: z.array(DashboardSpecSchema).max(40),
  author: text(80),
  createdAt: iso,
  updatedAt: iso,
}) satisfies z.ZodType<TrackingPlan>;
