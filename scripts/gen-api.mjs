// Regenerates packages/api-client from the FastAPI OpenAPI schema.
// CI runs this and fails on a diff, so the TS types never drift from the API.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const api = join(root, 'apps/api')
const py = existsSync(join(api, '.venv/bin/python')) ? join(api, '.venv/bin/python') : 'python'
const spec = execFileSync(py, ['-c', 'import json,sys; from app.main import app; sys.stdout.write(json.dumps(app.openapi(), indent=1, sort_keys=True))'],
  { cwd: api, env: { ...process.env, SECRET_KEY: 'x'.repeat(40) }, maxBuffer: 64 * 1024 * 1024 })
const out = join(root, 'packages/api-client/openapi.json')
writeFileSync(out, spec)
execFileSync('pnpm', ['--filter', '@workspace/api-client', 'exec', 'openapi-typescript', 'openapi.json', '-o', 'src/schema.d.ts'],
  { cwd: root, stdio: 'inherit' })
