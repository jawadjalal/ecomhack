/**
 * Web rules: persisted in the kv store ("web-rules"), validated on the way in. Values are plain
 * text (the runtime uses textContent), selectors and styles are length-capped and screened, so a
 * rule can change what a page says and how it looks, never run script or load anything.
 */
import { z } from "zod";
import { kvGet, kvSet } from "@/lib/db/json-store";
import { TRAFFIC_SOURCES, type TrafficSource, type WebRule, type WebRuleDraft, type WebRuleOutcome, type WebRuleStatus } from "@/lib/contracts";
import { id } from "@/lib/ids";
import { needsMerchant } from "./claims";

const KEY = "web-rules";
export const MAX_RULES_PER_SITE = 50;
export const MAX_CHANGES = 5;

export const SiteSchema = z
  .string()
  .trim()
  .regex(/^[\w.-]{1,64}$/, "site: letters, numbers, dot, dash or underscore (max 64)");

const UNSAFE_STYLE = /url\s*\(|expression|@import|javascript:|[{}<>]|\\/i;

export const WebChangeSchema = z
  .object({
    action: z.enum(["text", "banner", "badge", "hide", "style"]),
    selector: z
      .string()
      .trim()
      .max(200)
      .refine((s) => !/[{}<>\n]/.test(s), "selector can't contain { } < > or newlines")
      .optional(),
    value: z.string().trim().max(200).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action !== "banner" && !c.selector) ctx.addIssue({ code: "custom", message: `${c.action} needs a selector` });
    if (c.action !== "hide" && !c.value) ctx.addIssue({ code: "custom", message: `${c.action} needs a value` });
    if (c.action === "style" && c.value && UNSAFE_STYLE.test(c.value)) ctx.addIssue({ code: "custom", message: "style can't load URLs or use { } < > \\" });
  })
  .transform((c) => ({
    action: c.action,
    ...(c.action === "banner" ? {} : { selector: c.selector }),
    ...(c.action === "hide" ? {} : { value: c.value }),
  }));

export const WebAudienceSchema = z.object({
  sources: z.array(z.enum(TRAFFIC_SOURCES as [TrafficSource, ...TrafficSource[]])).max(7).optional(),
  queryIncludes: z.array(z.string().trim().toLowerCase().min(1).max(60)).max(10).optional(),
  paths: z.array(z.string().trim().startsWith("/").max(200)).max(10).optional(),
});

export const WebRuleDraftSchema = z.object({
  site: SiteSchema,
  name: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().max(400).optional(),
  audience: WebAudienceSchema.default({}),
  changes: z.array(WebChangeSchema).min(1).max(MAX_CHANGES),
  mode: z.enum(["test", "always"]).default("test"),
  allocation: z.number().min(0.05).max(0.95).default(0.5),
  metric: z
    .string()
    .trim()
    .regex(/^[$\w:.-]{1,64}$/)
    .default("order_completed"),
  author: z.string().trim().max(80).default("manual"),
  prompt: z.string().trim().max(1000).optional(),
});

export const WebRulePatchSchema = z.object({
  status: z.enum(["draft", "running", "paused", "shipped"]).optional(),
  name: WebRuleDraftSchema.shape.name.optional(),
  hypothesis: WebRuleDraftSchema.shape.hypothesis,
  audience: WebAudienceSchema.optional(),
  changes: WebRuleDraftSchema.shape.changes.optional(),
  mode: z.enum(["test", "always"]).optional(),
  allocation: z.number().min(0.05).max(0.95).optional(),
});
export type WebRulePatch = z.infer<typeof WebRulePatchSchema>;

export class WebRuleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const all = () => kvGet<WebRule[]>(KEY, () => []);

const isLive = (status: WebRuleStatus) => status === "running" || status === "shipped";

/**
 * A rule goes live only when every text is the merchant's to publish: no "[Your …]" left to fill in, no
 * "[Confirm: …]" claim Darwin couldn't find on the page (claims.ts). Drafts can hold them.
 */
function assertPublishable(changes: WebRule["changes"]) {
  const pending = changes.find((c) => needsMerchant(c.value));
  if (pending) {
    throw new WebRuleError(
      `“${pending.value}” needs you first: replace the [bracketed] text with your real details (or confirm the claim by removing the brackets). Darwin never publishes facts about your store that it can't find on your page.`,
      400,
    );
  }
}

export function listRules(site?: string): WebRule[] {
  return site ? all().filter((r) => r.site === site) : [...all()];
}

export function getRule(ruleId: string): WebRule | undefined {
  return all().find((r) => r.id === ruleId);
}

export function createRule(draft: WebRuleDraft | unknown, status: WebRuleStatus = "draft"): WebRule {
  const d = WebRuleDraftSchema.parse(draft);
  if (listRules(d.site).length >= MAX_RULES_PER_SITE) throw new WebRuleError(`A site can have at most ${MAX_RULES_PER_SITE} rules. Delete some first.`);
  if (isLive(status)) assertPublishable(d.changes);
  const now = new Date().toISOString();
  const rule: WebRule = {
    id: id("wr"),
    ...d,
    status,
    createdAt: now,
    updatedAt: now,
    ...(status === "running" || status === "shipped" ? { startedAt: now } : {}),
    ...(status === "shipped" ? { shippedAt: now } : {}),
  };
  kvSet(KEY, [...all(), rule]);
  return rule;
}

/**
 * Edit a rule. Content (changes, audience) is frozen once it has run in a test, since changing it
 * would mix two treatments in one result. Duplicate the rule instead.
 */
export function updateRule(ruleId: string, patch: WebRulePatch | unknown): WebRule {
  const p = WebRulePatchSchema.parse(patch);
  const current = getRule(ruleId);
  if (!current) throw new WebRuleError("Rule not found", 404);
  if ((p.changes || p.audience || p.mode || p.allocation) && current.mode === "test" && current.startedAt) {
    throw new WebRuleError("This test has already run: its changes and audience are locked so the result stays honest. Create a new rule instead.", 409);
  }
  if (current.status === "shipped" && p.status && p.status !== "shipped" && p.status !== "paused") {
    throw new WebRuleError("A shipped rule can only be paused (turned off).", 409);
  }
  const now = new Date().toISOString();
  const next: WebRule = { ...current, ...p, updatedAt: now };
  if (isLive(next.status) && (p.status || p.changes)) assertPublishable(next.changes);
  if ((p.status === "running" || p.status === "shipped") && !current.startedAt) next.startedAt = now;
  if (p.status === "shipped" && !current.shippedAt) next.shippedAt = now;
  kvSet(
    KEY,
    all().map((r) => (r.id === ruleId ? next : r)),
  );
  return next;
}

/** End a test on its result (autopilot or a person): ship it to the audience or stop it, and say why. */
export function endRule(ruleId: string, outcome: WebRuleOutcome): WebRule {
  const rule = updateRule(ruleId, { status: outcome.decision === "shipped" ? "shipped" : "paused" });
  const next = { ...rule, outcome };
  kvSet(
    KEY,
    all().map((r) => (r.id === ruleId ? next : r)),
  );
  return next;
}

export function deleteRule(ruleId: string): boolean {
  const rules = all();
  const next = rules.filter((r) => r.id !== ruleId);
  kvSet(KEY, next);
  return next.length !== rules.length;
}

/** Tests and demo resets. */
export function resetWebRules(site?: string) {
  kvSet(KEY, site ? all().filter((r) => r.site !== site) : []);
}
