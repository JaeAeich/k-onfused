/**
 * Tool generator. The universe is the cartesian product category → app (vendor × edition) → resource →
 * action → variant, enumerated in a fixed order and shuffled once with the seed. Tool i is the i-th
 * element of that shuffle, so the first 1,000 tools of a 200k run are the same as a 1,000-tool run.
 * Each tool gets a name, a JSON Schema built from the field layout, and a bank-A description.
 */
import type { JsonSchema, ToolDef } from '../types.js';
import { makeRng, pick, shuffle } from '../rng.js';
import {
  ACTIONS,
  CATEGORIES,
  EDITIONS,
  FIELDS,
  GEN_VERSION,
  ID_DESC,
  ID_TAG,
  DESC_CREATE_VARIANT,
  DESC_LIST_VARIANT,
  DESC_OPTIONAL,
  idFieldName,
  idFieldSchema,
  type ActionDef,
  type Category,
  type IdKind,
  type ResourceSpec,
  type Variant,
} from './vocab.js';

export interface Combo {
  resource: ResourceSpec;
  action: ActionDef;
  variant: Variant;
  idKind: IdKind | null;
}
export interface AppSpec {
  category: Category;
  vendor: string;
  vendorDisplay: string;
  edition: string;
  app: string;
  app_display: string;
}
/** ToolDef plus the generator internals tasks.ts needs; strip before serializing. */
export interface GenTool extends ToolDef {
  _app: AppSpec;
  _combo: Combo;
}

// ≤55 so that Claude Code's MCP prefix (mcp__ts__, 9 chars) keeps names within the 64-char API limit
export const NAME_RE = /^[a-z0-9_]{1,55}$/;

export function combosFor(cat: Category): Combo[] {
  const out: Combo[] = [];
  for (const resource of cat.resources) {
    for (const actionKey of resource.template.actions) {
      const action = ACTIONS[actionKey];
      if (!action) throw new Error(`unknown action ${actionKey}`);
      if (action.mode === 'target') {
        for (const idKind of resource.template.idKinds)
          out.push({ resource, action, variant: { tag: ID_TAG[idKind], extra: [] }, idKind });
      } else {
        for (const variant of action.variants)
          out.push({ resource, action, variant, idKind: null });
      }
    }
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function appsFor(cat: Category): AppSpec[] {
  const vendors = [
    ...cat.realVendors,
    ...cat.fictionalVendors.map((k) => ({ key: k, display: cap(k) })),
  ];
  const out: AppSpec[] = [];
  for (const v of vendors)
    for (const e of EDITIONS) {
      out.push({
        category: cat,
        vendor: v.key,
        vendorDisplay: v.display,
        edition: e.key,
        app: e.key ? `${v.key}_${e.key}` : v.key,
        app_display: e.display ? `${v.display} ${e.display}` : v.display,
      });
    }
  return out;
}

interface Block {
  cat: Category;
  apps: AppSpec[];
  combos: Combo[];
  offset: number;
}
export interface Universe {
  total: number;
  blocks: Block[];
}

export function buildUniverse(): Universe {
  const blocks: Block[] = [];
  let offset = 0;
  const vendors = new Set<string>();
  for (const cat of CATEGORIES) {
    for (const v of [...cat.realVendors.map((r) => r.key), ...cat.fictionalVendors]) {
      if (vendors.has(v)) throw new Error(`duplicate vendor key in vocab: ${v}`);
      vendors.add(v);
    }
    const apps = appsFor(cat);
    const combos = combosFor(cat);
    blocks.push({ cat, apps, combos, offset });
    offset += apps.length * combos.length;
  }
  return { total: offset, blocks };
}

export function locate(u: Universe, idx: number): { app: AppSpec; combo: Combo } {
  for (let b = u.blocks.length - 1; b >= 0; b--) {
    const blk = u.blocks[b]!;
    if (idx >= blk.offset) {
      const local = idx - blk.offset;
      const appIdx = Math.floor(local / blk.combos.length);
      return { app: blk.apps[appIdx]!, combo: blk.combos[local % blk.combos.length]! };
    }
  }
  throw new Error(`index out of universe: ${idx}`);
}

export const article = (noun: string) => (/^[aeiou]/i.test(noun) ? 'an' : 'a');
export const plural = (noun: string) =>
  /[^aeiou]y$/.test(noun)
    ? noun.slice(0, -1) + 'ies'
    : /(s|x|ch|sh)$/.test(noun)
      ? noun + 'es'
      : noun + 's';
const listWords = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const human = (f: string) => f.replace(/_/g, ' ');

/** Ordered field layout for a tool: which arg names are required/optional and their schemas. */
export function layout(
  app: AppSpec,
  combo: Combo,
): { props: Record<string, JsonSchema>; required: string[]; optional: string[] } {
  const { resource, action, variant, idKind } = combo;
  const tpl = resource.template;
  const props: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const optional: string[] = [];
  const add = (name: string, schema: JsonSchema, req: boolean) => {
    if (name in props) return;
    props[name] = schema;
    (req ? required : optional).push(name);
  };
  if (action.mode !== 'target' || idKind === 'name') {
    add(tpl.parent.field, { type: 'string', description: `The ${tpl.parent.descNoun}` }, true);
  }
  if (action.mode === 'target' && idKind) {
    add(
      idFieldName(resource.name, idKind),
      { ...idFieldSchema(idKind), description: `The ${resource.noun} ${ID_DESC[idKind]}` },
      true,
    );
  }
  if (action.mode === 'create' && tpl.createField)
    add(tpl.createField, FIELDS[tpl.createField], true);
  for (const k of action.required) add(k, FIELDS[k], true);
  for (const k of variant.extra) add(k, FIELDS[k], true);
  for (const k of action.optional) add(k, FIELDS[k], false);
  return { props, required, optional };
}

export function buildTool(
  app: AppSpec,
  combo: Combo,
  universeIdx: number,
  seed: number,
): Omit<GenTool, 'tool_id' | 'rank'> {
  const { resource, action, variant, idKind } = combo;
  const rng = makeRng(`${seed}:d:${universeIdx}`);
  const name = `${app.app}_${action.key}_${resource.name}${variant.tag ? `_${variant.tag}` : ''}`;
  if (!NAME_RE.test(name)) throw new Error(`bad tool name: ${name}`);
  const { props, required, optional } = layout(app, combo);

  const verb = pick(rng, action.descVerb).replace(/ an?$/, '');
  const App = app.app_display;
  const requires = `Requires ${listWords(required.map(human))}.`;
  let description: string;
  if (action.mode === 'create') {
    const variantText = DESC_CREATE_VARIANT[variant.tag] ?? '';
    description = `${verb} ${article(resource.noun)} ${resource.noun} in ${App}${variantText}. ${requires}`;
  } else if (action.mode === 'list') {
    const variantText = DESC_LIST_VARIANT[variant.tag] ?? '';
    description = `${verb} ${plural(resource.noun)} in ${App}${variantText}. ${requires}`;
  } else {
    const extras = required.filter((r) => r !== idFieldName(resource.name, idKind!));
    const noun = `${article(resource.noun)} ${resource.noun}`;
    description = `${verb} ${noun} in ${App}, identified by its ${ID_DESC[idKind!]}.`;
    if (extras.length) description += ` Requires ${listWords(extras.map(human))}.`;
  }
  if (optional.length)
    description += ` ${pick(rng, DESC_OPTIONAL)} ${listWords(optional.map(human))}.`;

  const input_schema: JsonSchema = {
    type: 'object',
    properties: props,
    required,
    additionalProperties: false,
  };
  return {
    name,
    description,
    input_schema,
    category: app.category.key,
    app: app.app,
    app_display: App,
    resource: resource.name,
    action: action.key,
    variation_id: variant.tag || 'base',
    _app: app,
    _combo: combo,
  };
}

export const sigKey = (t: ToolDef) =>
  `${t.app}|${t.resource}|${t.action}|${[...((t.input_schema.required as string[]) ?? [])].sort().join(',')}`;

/**
 * Deterministic prefix universe: the first `count` tools of any run with the same seed are identical,
 * so a 1k catalog is a prefix of the 200k catalog. rank is provisional (= position) until tasks assign it.
 */
export function generateTools(opts: { seed: number; count: number }): {
  tools: GenTool[];
  universeSize: number;
} {
  const u = buildUniverse();
  if (opts.count > u.total) throw new Error(`count ${opts.count} exceeds universe ${u.total}`);
  const perm = shuffle(
    makeRng(`${opts.seed}:perm:${GEN_VERSION}`),
    Array.from({ length: u.total }, (_, i) => i),
  );
  const tools: GenTool[] = [];
  const names = new Set<string>();
  const sigs = new Set<string>();
  for (let i = 0; i < opts.count; i++) {
    const uidx = perm[i]!;
    const { app, combo } = locate(u, uidx);
    const t: GenTool = { tool_id: `t${i}`, rank: i, ...buildTool(app, combo, uidx, opts.seed) };
    if (names.has(t.name)) throw new Error(`duplicate tool name ${t.name}`);
    const s = sigKey(t);
    if (sigs.has(s)) throw new Error(`duplicate signature ${s} (${t.name})`);
    names.add(t.name);
    sigs.add(s);
    tools.push(t);
  }
  return { tools, universeSize: u.total };
}

/** Vendor key of an app key ("slack_enterprise" → "slack"). */
export const vendorOf = (app: string): string => {
  for (const e of EDITIONS)
    if (e.key && app.endsWith(`_${e.key}`)) return app.slice(0, -e.key.length - 1);
  return app;
};

export const stripGen = (t: GenTool): ToolDef => {
  const { _app, _combo, ...rest } = t;
  return rest;
};
