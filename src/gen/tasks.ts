/**
 * Task generator. A task step is one target tool plus a natural-language prompt that (a) names the app,
 * (b) supplies every required argument in a form only that tool's signature accepts (URL vs id vs key),
 * and (c) shares no 3-gram with the tool's description (bank B wording only). Multi-step tasks join two
 * steps (chain or cross_app). `generateTasks` also assigns ranks: targets get TARGET_RANK, everything else
 * a permutation position, so `rank < N - pinned` plus the trial's own targets = exactly N tools.
 */
import type { ArgConstraint, Task } from '../types.js';
import { makeRng, pick, rint, shuffle, type Rng } from '../rng.js';
import {
  FIELDS,
  POOL,
  PROMPT_APP,
  PROMPT_CHANGES,
  PROMPT_FIELD,
  PROMPT_ID,
  STOPWORDS,
  idFieldName,
  type FieldKey,
} from './vocab.js';
import { article, layout, plural, type GenTool } from './tools.js';

const fmt = (tpl: string, v: string) => tpl.replace('{v}', v);
const joinAnd = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const distinct = <T>(rng: Rng, arr: readonly T[], n: number) => shuffle(rng, [...arr]).slice(0, n);
const enumOf = (k: FieldKey) => FIELDS[k].enum as string[];

/** Value + prompt phrase + grading constraint for one arg. */
interface Rendered {
  value: unknown;
  phrase: string;
  constraints: Record<string, ArgConstraint>;
}

/** Pick a value for one argument, phrase it for the prompt (bank B), and derive its grading constraint. */
function renderField(
  rng: Rng,
  key: FieldKey,
  ctx: { parentValue: string; parentValues: string[]; createField: FieldKey | null },
): Rendered {
  const P = (v: string) => fmt(pick(rng, PROMPT_FIELD[key]), v);
  switch (key) {
    case 'title': {
      const v = pick(rng, POOL.titles);
      return { value: v, phrase: P(v), constraints: { [key]: { ieq: v } } };
    }
    case 'name': {
      const v = pick(rng, POOL.names);
      return { value: v, phrase: P(v), constraints: { [key]: { ieq: v } } };
    }
    case 'body': {
      const v = pick(rng, POOL.bodies);
      return { value: v, phrase: P(v), constraints: { [key]: { ieq: v } } };
    }
    case 'priority':
    case 'severity':
    case 'visibility':
    case 'currency': {
      const v = pick(rng, enumOf(key));
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
    case 'state': {
      const v = pick(rng, ['open', 'closed']);
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
    case 'labels': {
      const v = distinct(rng, POOL.labels, 2);
      return { value: v, phrase: P(joinAnd(v)), constraints: { [key]: { includes: v } } };
    }
    case 'recipients':
    case 'attendees': {
      const v = distinct(rng, POOL.emails, 2);
      return { value: v, phrase: P(joinAnd(v)), constraints: { [key]: { includes: v } } };
    }
    case 'assignee': {
      const v = pick(rng, POOL.emails);
      return { value: { email: v }, phrase: P(v), constraints: { 'assignee.email': { eq: v } } };
    }
    case 'email': {
      const v = pick(rng, POOL.emails);
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
    case 'due_date':
    case 'until':
    case 'since': {
      const v = pick(rng, POOL.dates);
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
    case 'start':
    case 'end': {
      const v = pick(rng, POOL.datetimes);
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
    case 'changes': {
      // work items / documents have titles; people & containers have names
      const byName = ctx.createField !== 'title';
      const v = byName ? pick(rng, POOL.names) : pick(rng, POOL.titles);
      const sub = byName ? 'name' : 'title';
      return {
        value: { [sub]: v },
        phrase: fmt(pick(rng, PROMPT_CHANGES[sub]), v),
        constraints: { [`changes.${sub}`]: { ieq: v } },
      };
    }
    case 'amount': {
      const v = pick(rng, POOL.amounts);
      return { value: v, phrase: P(String(v)), constraints: { [key]: { eq: v } } };
    }
    case 'destination': {
      const v = pick(
        rng,
        ctx.parentValues.filter((x) => x !== ctx.parentValue),
      );
      return { value: v, phrase: P(v), constraints: { [key]: { eq: v } } };
    }
  }
}

/** The identifying value in exactly the form the target signature expects (id | key | url | name | email). */
function renderId(rng: Rng, t: GenTool, parentValue: string): { value: string; phrase: string } {
  const { resource, idKind } = t._combo;
  const alias = pick(rng, resource.aliases);
  const P = (v: string) => fmt(pick(rng, PROMPT_ID[idKind!]), v).replace('{alias}', alias);
  switch (idKind) {
    case 'id': {
      const v = String(rint(rng, 1000, 99999));
      return { value: v, phrase: P(v) };
    }
    case 'key': {
      const v = `${pick(rng, POOL.keysPrefix)}-${rint(rng, 1, 999)}`;
      return { value: v, phrase: P(v) };
    }
    case 'url': {
      const slug = parentValue
        .replace(/^#/, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase();
      const v = `https://${t._app.vendor}.example.com/${slug}/${plural(resource.name)}/${rint(rng, 1000, 99999)}`;
      return { value: v, phrase: P(v) };
    }
    case 'name': {
      const v = pick(rng, POOL.names);
      return { value: v, phrase: P(v) };
    }
    case 'email': {
      const v = pick(rng, POOL.emails);
      return { value: v, phrase: P(v) };
    }
    default:
      throw new Error('renderId on non-target action');
  }
}

/** Phrases + constraints for the non-identifying required fields of `t`. */
function renderFields(
  rng: Rng,
  t: GenTool,
  keys: FieldKey[],
  parentValue: string,
): { phrases: string[]; constraints: Record<string, ArgConstraint> } {
  const tpl = t._combo.resource.template;
  const constraints: Record<string, ArgConstraint> = {};
  const phrases: string[] = [];
  // amount+currency read better as one phrase
  const merged = keys.includes('amount') && keys.includes('currency');
  if (merged) {
    const a = pick(rng, POOL.amounts);
    const c = pick(rng, enumOf('currency'));
    phrases.push(fmt(pick(rng, PROMPT_FIELD.amount), `${a} ${c}`));
    constraints.amount = { eq: a };
    constraints.currency = { eq: c };
  }
  for (const k of keys) {
    if (merged && (k === 'amount' || k === 'currency')) continue;
    const r = renderField(rng, k, {
      parentValue,
      parentValues: tpl.parent.values,
      createField: tpl.createField,
    });
    phrases.push(r.phrase);
    Object.assign(constraints, r.constraints);
  }
  return { phrases, constraints };
}

/** Build one prompt + grading constraints for a target tool. Deterministic given `rng`. */
export function renderTask(
  t: GenTool,
  rng: Rng,
): { prompt: string; args: Record<string, ArgConstraint>; parentValue: string } {
  const { resource, action, idKind } = t._combo;
  const tpl = resource.template;
  const { required } = layout(t._app, t._combo);
  const constraints: Record<string, ArgConstraint> = {};

  const parentValue = pick(rng, tpl.parent.values);
  const parentNeeded = required.includes(tpl.parent.field);
  if (parentNeeded) constraints[tpl.parent.field] = { eq: parentValue };
  const parentPhrase = parentNeeded ? fmt(pick(rng, tpl.parent.promptPhrase), parentValue) : '';
  const appPhrase = pick(rng, PROMPT_APP).replace('{app}', t._app.app_display);

  const fieldKeys = required.filter(
    (r) => r !== tpl.parent.field && (!idKind || r !== idFieldName(resource.name, idKind)),
  ) as FieldKey[];
  const fields = renderFields(rng, t, fieldKeys, parentValue);
  Object.assign(constraints, fields.constraints);

  const verb = pick(rng, action.promptVerb);
  const alias = pick(rng, resource.aliases);
  let head: string;
  if (action.mode === 'create') head = `${verb} ${article(alias)} ${alias} ${parentPhrase}`;
  else if (action.mode === 'list') head = `${verb} ${plural(alias)} ${parentPhrase}`;
  else {
    const id = renderId(rng, t, parentValue);
    constraints[idFieldName(resource.name, idKind!)] = { eq: id.value };
    head = `${verb} ${id.phrase}${parentPhrase ? ` ${parentPhrase}` : ''}`;
  }
  const front = rng() < 0.4;
  const parts = front
    ? [cap(appPhrase) + ',', head.charAt(0).toLowerCase() + head.slice(1), ...fields.phrases]
    : [head, appPhrase, ...fields.phrases];
  const prompt = parts.join(' ').replace(/\s+/g, ' ').trim() + '.';
  return { prompt, args: constraints, parentValue };
}

/**
 * Second step of a chain: act on the item the first step created, referred to as "it". The id arg must
 * equal whatever id the first call returned (`ref: 0`), so the worker has to read the tool output.
 */
function renderFollowup(
  t: GenTool,
  rng: Rng,
  parentValue: string,
): { phrase: string; args: Record<string, ArgConstraint> } {
  const { resource, action, idKind } = t._combo;
  const idField = idFieldName(resource.name, idKind!);
  const keys = layout(t._app, t._combo).required.filter((r) => r !== idField) as FieldKey[];
  const fields = renderFields(rng, t, keys, parentValue);
  // "Pull up" → "pull it up"; "Nuke" → "nuke it"
  const verb = pick(rng, action.promptVerb).toLowerCase();
  const m = /^(\S+) (up|off|back|in|out)$/.exec(verb);
  const head = m ? `${m[1]} it ${m[2]}` : `${verb} it`;
  return {
    phrase: [head, ...fields.phrases].join(' '),
    args: { ...fields.constraints, [idField]: { ref: 0 } },
  };
}

// ---- disjointness checks ----
export const contentWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#@./-]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w));
const ngrams = (ws: string[], n: number) => {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
};

export function assertDisjoint(prompt: string, t: GenTool): void {
  const p = prompt.toLowerCase();
  if (p.includes(t.name) || p.includes(t.name.replace(/_/g, ' ')))
    throw new Error(`prompt contains tool name: ${t.name}`);
  // the app name legitimately appears in both; collapse it to one token so it can't form a shared n-gram
  const app = t.app_display.toLowerCase();
  const norm = (s: string) => s.toLowerCase().split(app).join(' appname ');
  const a = ngrams(contentWords(norm(t.description)), 3);
  const b = ngrams(contentWords(norm(prompt)), 3);
  for (const g of b)
    if (a.has(g))
      throw new Error(
        `prompt/description share 3-gram "${g}"\n  prompt: ${prompt}\n  desc:   ${t.description}`,
      );
}

/** Rank of every task target: outside any `rank < N`, so each trial pins only its own targets. */
export const TARGET_RANK = 1_000_000_000;

const pairKey = (t: GenTool) => `${t.resource}|${t.action}`;
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// don't read as a follow-up: "let it with …" (share); "refund it for 899" of a 32 GBP charge (refund)
const CHAIN_SKIP = new Set(['share', 'refund']);

/**
 * Generates tasks AND assigns ranks on `tools` in place (targets TARGET_RANK, others 0..).
 * The first `count` tasks are single-step and do not depend on `multi`; then `multi` two-step tasks
 * alternate chain / cross_app, drawn from the same shuffled order after the single-step targets.
 */
export function generateTasks(
  tools: GenTool[],
  opts: { seed: number; count: number; multi?: number },
): Task[] {
  if (opts.count > tools.length) throw new Error('more tasks than tools');
  const order = shuffle(
    makeRng(`${opts.seed}:pickorder`),
    tools.map((_, i) => i),
  );
  const appsByPair = new Map<string, Set<string>>();
  for (const t of tools) {
    const k = pairKey(t);
    if (!appsByPair.has(k)) appsByPair.set(k, new Set());
    appsByPair.get(k)!.add(t.app);
  }
  const nearDup = (ts: GenTool[]) => ts.some((t) => (appsByPair.get(pairKey(t))?.size ?? 1) > 1);

  const targets = order.slice(0, opts.count).map((i) => tools[i]!);
  const tasks: Task[] = targets.map((t, i) => {
    const { prompt, args } = renderTask(t, makeRng(`${opts.seed}:t:${i}`));
    assertDisjoint(prompt, t);
    return {
      task_id: `t${String(i + 1).padStart(3, '0')}`,
      prompt,
      target_tool_ids: [t.tool_id],
      expected_calls: [{ tool_id: t.tool_id, args }],
      tags: { near_duplicate: nearDup([t]), cross_app: false, multi_step: false },
    };
  });

  const used = new Set(targets.map((t) => t.tool_id));
  const rest = order.slice(opts.count).map((i) => tools[i]!);
  // chain step 2 candidates: act-on-one-item tools addressed by numeric id, per app + resource. Skip
  // resources also addressable by name/email: step 1 puts that value in the prompt, so a by-name/by-email
  // call on step 2 would be just as correct.
  const byIdTools = new Map<string, GenTool[]>();
  const altId = (t: GenTool) =>
    t._combo.resource.template.idKinds.some((k) => k === 'name' || k === 'email');
  for (const t of tools)
    if (
      t._combo.action.mode === 'target' &&
      t._combo.idKind === 'id' &&
      !CHAIN_SKIP.has(t.action) &&
      !altId(t)
    ) {
      const k = `${t.app}|${t.resource}`;
      if (!byIdTools.has(k)) byIdTools.set(k, []);
      byIdTools.get(k)!.push(t);
    }

  let cursor = 0;
  const next = (pred: (t: GenTool) => boolean): GenTool | null => {
    while (cursor < rest.length) {
      const t = rest[cursor++]!;
      if (!used.has(t.tool_id) && pred(t)) return t;
    }
    return null;
  };
  const push = (
    parts: GenTool[],
    prompt: string,
    args: Record<string, ArgConstraint>[],
    cross: boolean,
  ) => {
    for (const p of parts) used.add(p.tool_id);
    tasks.push({
      task_id: `t${String(tasks.length + 1).padStart(3, '0')}`,
      prompt,
      target_tool_ids: parts.map((p) => p.tool_id),
      expected_calls: parts.map((p, i) => ({ tool_id: p.tool_id, args: args[i]! })),
      tags: { near_duplicate: nearDup(parts), cross_app: cross, multi_step: true },
    });
  };

  for (let j = 0; j < (opts.multi ?? 0); j++) {
    const rng = makeRng(`${opts.seed}:m:${j}`);
    for (;;) {
      if (j % 2 === 0) {
        const a = next(
          (t) => t._combo.action.mode === 'create' && byIdTools.has(`${t.app}|${t.resource}`),
        );
        if (!a) throw new Error('ran out of chain candidates');
        const bs = byIdTools.get(`${a.app}|${a.resource}`)!.filter((t) => !used.has(t.tool_id));
        if (!bs.length) continue;
        const b = pick(rng, bs);
        const first = renderTask(a, rng);
        const then = renderFollowup(b, rng, first.parentValue);
        const prompt = `${first.prompt.slice(0, -1)}, then ${then.phrase}.`;
        try {
          assertDisjoint(prompt, a);
          assertDisjoint(prompt, b);
        } catch {
          continue;
        }
        push([a, b], prompt, [first.args, then.args], false);
      } else {
        const a = next(() => true);
        const b = a && next((t) => t.category !== a.category);
        if (!a || !b) throw new Error('ran out of cross-app candidates');
        const pa = renderTask(a, rng);
        const pb = renderTask(b, rng);
        const prompt = `${pa.prompt} Also, ${lcFirst(pb.prompt)}`;
        try {
          assertDisjoint(prompt, a);
          assertDisjoint(prompt, b);
        } catch {
          continue;
        }
        push([a, b], prompt, [pa.args, pb.args], true);
      }
      break;
    }
  }

  let r = 0;
  for (const t of tools) t.rank = used.has(t.tool_id) ? TARGET_RANK : r++;
  return tasks;
}
