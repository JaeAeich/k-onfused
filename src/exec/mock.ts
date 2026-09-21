import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JsonSchema, ToolDef } from '../types.js';
import { rint, type Rng } from '../rng.js';

/**
 * One generic handler for every tool: validate against the tool's JSON Schema, log the call,
 * return a plausible success payload. Never reveals whether a tool was the target.
 */
export class MockExecutor {
  private ajv = new Ajv({ allErrors: true, strict: false });
  private validators = new Map<string, ValidateFunction>();
  /** per-trial log of created items (chained tasks act on these ids) */
  readonly created: { tool: string; id: string; args: unknown }[] = [];

  constructor(private rng: Rng) {
    addFormats(this.ajv);
  }

  private validator(t: ToolDef): ValidateFunction {
    const cached = this.validators.get(t.tool_id);
    if (cached) return cached;
    const v = this.ajv.compile(t.input_schema as JsonSchema);
    this.validators.set(t.tool_id, v);
    return v;
  }

  execute(tool: ToolDef, args: unknown): { valid: boolean; response: unknown } {
    const v = this.validator(tool);
    // (validator throws on compile failure, never undefined)
    if (!v(args)) {
      return {
        valid: false,
        response: {
          error: 'invalid_arguments',
          details: this.ajv.errorsText(v.errors, { separator: '; ' }),
        },
      };
    }
    const a = args as Record<string, unknown>;
    const idField = Object.keys(a).find(
      (k) => k.endsWith('_id') || k === 'url' || k.endsWith('_key'),
    );
    const id = idField ? String(a[idField]) : `${tool.resource}_${rint(this.rng, 10000, 99999)}`;
    let response: unknown;
    switch (tool.action) {
      case 'list': {
        const items = Array.from({ length: 3 }, (_, i) => ({
          id: `${tool.resource}_${rint(this.rng, 10000, 99999)}`,
          title: `${tool.resource} ${i + 1}`,
        }));
        response = { ok: true, count: items.length, items };
        break;
      }
      case 'create':
      case 'send':
      case 'invite': {
        // always a fresh numeric id (never an input field), so a chained by-id call can use it
        const newId = String(rint(this.rng, 10000, 99999));
        this.created.push({ tool: tool.name, id: newId, args });
        response = { ok: true, id: newId, created: true, [tool.resource]: { ...a, id: newId } };
        break;
      }
      case 'get':
        response = {
          ok: true,
          [tool.resource]: { id, state: 'open', updated_at: '2026-09-20T10:00:00Z' },
        };
        break;
      default:
        response = { ok: true, id, action: tool.action, status: 'applied' };
    }
    return { valid: true, response };
  }
}
