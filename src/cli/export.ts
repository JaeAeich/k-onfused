import { Command } from 'commander';
import { config } from '../config.js';
import { RESULTS_FILE, readResults } from '../results.js';
import { exportTrial, flushTelemetry, telemetryEnabled } from '../telemetry.js';

/** Re-export finished trials to the OTLP endpoint (e.g. after starting Phoenix later). */
const o = new Command().option('--in <file>', 'results JSONL', RESULTS_FILE).parse().opts();
if (!telemetryEnabled())
  throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is not set (see .env.example)');
const trials = readResults(o.in);
for (const r of trials) exportTrial(r);
await flushTelemetry();
console.log(`exported ${trials.length} trials from ${o.in} → ${config.otlpEndpoint}`);
