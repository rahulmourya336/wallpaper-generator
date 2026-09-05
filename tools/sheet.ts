/**
 * Headless contact sheet.
 *
 * Renders every style through the real engine and writes PNGs, so a change to
 * the compositor can be judged across the whole catalogue at once instead of
 * one style at a time in a browser.
 *
 *   npx esbuild tools/sheet.ts --bundle --platform=node --format=cjs \
 *     --outfile=.sheet.cjs --define:import.meta.env.DEV=false \
 *     --external:@resvg/resvg-js
 *   node .sheet.cjs
 *
 * Env:
 *   SEEDS=a,b,c   seeds to draw          (default alpha,bravo,charlie)
 *   ONLY=id,id    restrict to renderers  (default all)
 *   OUT=dir       output directory       (default shots)
 *   JOBS=n        parallel rasterisers   (default cpu count)
 *   W=440 H=950   frame size             (default phone portrait)
 *
 * Why it is shaped like this
 *
 * resvg is a Rust addon and it panics on some arc geometry, notably the `lens`
 * focal. A Rust panic calls abort(), which takes the whole process down: it is
 * not an exception and a try/catch around the render call will not see it. So
 * rasterising in the parent means one bad style loses the entire sweep. Every
 * rasterise therefore runs in a child process, and the parent treats a dead
 * child as "this one is SVG only" and keeps going.
 *
 * That isolation is also where the parallelism comes from. Composing all 43 is
 * ~0.6s; rasterising them is ~20s. Startup is ~30ms a process, so spreading the
 * expensive half over the cores costs about 6% overhead and saves most of the
 * wall clock.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fork } from 'node:child_process'
import { cpus } from 'node:os'
import { compose } from '../src/engine/compositor'
import { FAMILIES } from '../src/engine/registry'

// ---------------------------------------------------------------- child mode
// One argv flag re-enters this same bundle as a rasteriser, so there is only
// one build artefact. resvg is imported here and nowhere else, which keeps the
// addon out of the parent entirely.
if (process.argv[2] === '--raster') {
  const [, , , svgPath, pngPath, width] = process.argv
  const { Resvg } = require('@resvg/resvg-js')
  const { readFileSync } = require('node:fs')
  const svg = readFileSync(svgPath as string, 'utf8')
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(width) } }).render().asPng()
  writeFileSync(pngPath as string, png)
  process.exit(0)
}

// --------------------------------------------------------------- parent mode
const OUT = process.env.OUT || 'shots'
const SEEDS = (process.env.SEEDS || 'alpha,bravo,charlie').split(',').filter(Boolean)
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const JOBS = Math.max(1, Number(process.env.JOBS) || cpus().length)
const W = Number(process.env.W) || 440
const H = Number(process.env.H) || 950

type Entry = {
  id: string
  family: string
  seed: string
  layout: string
  backend: string
  truncated: boolean
  bytes: number
  /** lets a later run tell which styles a compositor edit actually moved */
  hash: string
  composeMs: number
  png: boolean
}

mkdirSync(`${OUT}/svg`, { recursive: true })

// --- phase 1: compose. Pure JS, cheap, cannot take the process down. --------
const jobs: { svg: string; png: string; entry: Entry }[] = []
const t0 = Date.now()

for (const fam of FAMILIES) {
  for (const r of fam.renderers) {
    if (ONLY && !ONLY.has(r.id)) continue
    for (const seed of SEEDS) {
      const stem = `${r.id}__${seed}`
      const a = Date.now()
      let res
      try {
        res = compose({
          renderer: r,
          seed,
          params: {},
          dims: { width: W, height: H },
          quality: 1,
        })
      } catch (e) {
        console.log(`${stem.padEnd(34)} COMPOSE FAILED  ${(e as Error).message}`)
        continue
      }
      const composeMs = Date.now() - a
      const svgPath = `${OUT}/svg/${stem}.svg`
      writeFileSync(svgPath, res.svg)
      jobs.push({
        svg: svgPath,
        png: `${OUT}/${stem}.png`,
        entry: {
          id: r.id,
          family: fam.id,
          seed,
          layout: String(res.layout),
          backend: res.backend,
          truncated: res.truncated,
          bytes: res.svg.length,
          hash: createHash('sha1').update(res.svg).digest('hex').slice(0, 12),
          composeMs,
          png: false,
        },
      })
    }
  }
}

const composedMs = Date.now() - t0
console.log(`composed ${jobs.length} in ${composedMs}ms, rasterising with ${JOBS} job(s)\n`)

// --- phase 2: rasterise, one child per frame, JOBS at a time. ---------------
let next = 0
let done = 0

function runOne(job: (typeof jobs)[number]): Promise<void> {
  return new Promise((resolve) => {
    const child = fork(process.argv[1] as string, ['--raster', job.svg, job.png, String(W)], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    // A panic exits non-zero (or on a signal). Either way the frame simply has
    // no PNG, and the SVG on disk is still a usable artefact.
    child.on('exit', (code) => {
      job.entry.png = code === 0 && existsSync(job.png)
      const e = job.entry
      console.log(
        `${`${e.id}__${e.seed}`.padEnd(34)}` +
          `${e.layout.padEnd(9)} ${e.backend.padEnd(6)} ` +
          `${String(Math.round(e.bytes / 1024)).padStart(4)}kb ` +
          `${e.truncated ? 'TRUNC ' : '      '}` +
          `${e.png ? '' : 'svg only'}`,
      )
      done++
      resolve()
    })
  })
}

async function worker(): Promise<void> {
  while (next < jobs.length) {
    const job = jobs[next++]
    if (job) await runOne(job)
  }
}

void (async () => {
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker))

  const entries = jobs.map((j) => j.entry)
  const drawn = entries.filter((e) => e.png).length
  const trunc = entries.filter((e) => e.truncated)

  writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify({ w: W, h: H, seeds: SEEDS, entries }, null, 2),
  )

  console.log(
    `\n${done} frames, ${drawn} rasterised, ${done - drawn} svg only, ` +
      `${Date.now() - t0}ms total`,
  )
  if (trunc.length) {
    console.log(`hit the time budget: ${[...new Set(trunc.map((e) => e.id))].join(', ')}`)
  }
  console.log(`manifest at ${OUT}/manifest.json`)
})()
