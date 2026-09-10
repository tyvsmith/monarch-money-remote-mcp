// Validate every *_Q export under src/monarch/ops against schema/monarch.graphql. Exit 1 on any error.
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSchema, parse, validate, NoUnusedFragmentsRule, specifiedRules } from 'graphql';

const sdl = await readFile('schema/monarch.graphql', 'utf8');
const schema = buildSchema(sdl, { assumeValidSDL: true });
const rules = specifiedRules.filter((r) => r !== NoUnusedFragmentsRule);

let failures = 0;
let checked = 0;
const files = (await readdir('src/monarch/ops')).filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
for (const file of files) {
  const mod = (await import(pathToFileURL(`src/monarch/ops/${file}`).href)) as Record<string, unknown>;
  for (const [name, value] of Object.entries(mod)) {
    if (!name.endsWith('_Q') || typeof value !== 'string') continue;
    checked += 1;
    try {
      const errors = validate(schema, parse(value), rules);
      if (errors.length) {
        failures += 1;
        console.error(`✗ ${file}:${name}\n  ${errors.map((e) => e.message).join('\n  ')}`);
      }
    } catch (err) {
      failures += 1;
      console.error(`✗ ${file}:${name} parse error: ${(err as Error).message}`);
    }
  }
}
console.log(`${checked - failures}/${checked} operations valid`);
process.exit(failures ? 1 : 0);
