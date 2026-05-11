// Side-effect-only env loader for pipeline scripts.
//
// Why this exists:
//   Node's `--env-file=.env.local` flag does NOT override env vars that
//   already exist in the parent shell. If the user has `ANTHROPIC_API_KEY=`
//   exported as an empty string (very common on Windows shells inherited
//   from Cursor/Claude Code/etc.), Haiku-dependent scripts silently fail
//   with "ANTHROPIC_API_KEY required" even when .env.local has the real
//   value. Same hazard for FEC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.
//
//   This shim parses .env.local ourselves and ALWAYS overrides, so the
//   file is the source of truth for pipeline scripts. Real shell env wins
//   only if .env.local is missing the key.
//
// Usage: `import './_env';` as the first line of any pipeline entry script.
//
// NOT loaded by the Next.js runtime — those scripts read .env.local via
// Next's built-in dotenv. This shim is for plain `tsx` invocation only.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    // Override: .env.local wins over inherited (possibly-empty) shell env.
    if (value !== '') {
      process.env[key] = value;
    } else if (process.env[key] === undefined) {
      process.env[key] = '';
    }
  }
}

loadEnvFile(join(process.cwd(), '.env.local'));
loadEnvFile(join(process.cwd(), '.env'));
