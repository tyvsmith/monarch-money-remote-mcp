// Refresh schema/monarch.graphql from the live web bundle. The web app's own operations are dumped to
// .cache/web-app-ops/ (gitignored) as a reference when writing new documents.
import { mkdir, writeFile } from 'node:fs/promises';
import { buildClientSchema, printSchema, type IntrospectionQuery } from 'graphql';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function jsUnescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_, g: string) => {
    if (g[0] === 'u') return String.fromCharCode(parseInt(g.slice(1), 16));
    if (g[0] === 'x') return String.fromCharCode(parseInt(g.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0' } as Record<string, string>)[g] ?? g;
  });
}

function extractIntrospection(bundle: string): IntrospectionQuery {
  const marker = "JSON.parse('{\"__schema\"";
  const start = bundle.indexOf(marker);
  if (start < 0) throw new Error('introspection marker not found in bundle');
  const from = start + "JSON.parse('".length;
  let end = from;
  for (;;) {
    end = bundle.indexOf("')", end);
    if (end < 0) throw new Error('unterminated JSON.parse string');
    if (bundle[end - 1] !== '\\') break;
    end += 1;
  }
  return JSON.parse(jsUnescape(bundle.slice(from, end))) as IntrospectionQuery;
}

function extractOps(bundle: string): Map<string, string> {
  const ops = new Map<string, string>();
  // Anchor on a preceding delimiter so a stray apostrophe in code cannot swallow later strings.
  const re = /(?:[=(,:]|\(0,[A-Za-z]\.[A-Za-z]\))\s*(['"])((?:\\.|(?!\1).)*?)\1/gs;
  for (const m of bundle.matchAll(re)) {
    const raw = m[2]!;
    if (!/^\s*(\\n)*\s*(query|mutation|fragment)\s/.test(raw)) continue;
    const txt = jsUnescape(raw);
    const head = /^\s*(query|mutation|fragment)\s+([A-Za-z0-9_]+)/.exec(txt);
    if (!head) continue;
    const name = head[1] === 'fragment' ? `_frag_${head[2]}` : head[2]!;
    if (!ops.has(name)) ops.set(name, txt);
  }
  return ops;
}

const index = await text('https://app.monarch.com/');
const version = /__APP_VERSION__="([^"]+)"/.exec(index)?.[1] ?? 'unknown';
const urls = [...index.matchAll(/src="(https:\/\/static\.monarch\.com\/static\/js\/[^"]+\.js)"/g)].map((m) => m[1]!);
if (urls.length === 0) throw new Error('no bundle URLs found in index.html');

let schemaJson: IntrospectionQuery | null = null;
const ops = new Map<string, string>();
for (const url of urls) {
  const bundle = await text(url);
  if (!schemaJson && bundle.includes("JSON.parse('{\"__schema\"")) schemaJson = extractIntrospection(bundle);
  for (const [k, v] of extractOps(bundle)) if (!ops.has(k)) ops.set(k, v);
}
if (!schemaJson) throw new Error('no bundle contained the introspection JSON');

const date = new Date().toISOString().slice(0, 10);
const opsDir = '.cache/web-app-ops';
await mkdir('schema', { recursive: true });
await mkdir(opsDir, { recursive: true });
const header = `# Monarch web app ${version} (${urls.map((u) => u.split('/').pop()).join(', ')}), captured ${date}. Refresh: npm run extract-schema\n`;
await writeFile('schema/monarch.graphql', header + printSchema(buildClientSchema(schemaJson)));
for (const [name, body] of ops) await writeFile(`${opsDir}/${name}.graphql`, body);
console.log(`schema: ${schemaJson.__schema.types.length} types; ops: ${ops.size}; app ${version}`);
