/** Round-trip proof for the dbrain-backed memory store. */
import { DbrainStore } from '../memory/dbrain-store.js'

const store = new DbrainStore({
  url: process.env.DBRAIN_URL ?? 'http://localhost:7978',
  token: process.env.DBRAIN_TOKEN ?? '',
})

await store.ensureAgent('marta', 'Marta')
await store.ensureAgent('juan', 'Juan')

await store.remember({ agentId: 'marta', kind: 'episodic', tick: 100,
  text: 'Juan owed me 50 credits and looked away when I asked.', about: 'juan' })
await store.remember({ agentId: 'marta', kind: 'episodic', tick: 340,
  text: 'Juan paid me back, but only after Lucia shamed him for it.', about: 'juan' })
await store.remember({ agentId: 'marta', kind: 'episodic', tick: 200,
  text: 'Lucia was kind at the clinic today.', about: 'lucia' })
await store.remember({ agentId: 'marta', kind: 'identity', tick: 0,
  text: 'Since the bankruptcy, she does not trust anyone with money.' })
await store.remember({ agentId: 'marta', kind: 'episodic', tick: 300,
  text: 'People say Pedro waters down the drinks.', about: 'pedro', secondHand: true })

const aboutJuan = await store.recall('marta', 'juan')
console.log('recall(marta → juan):')
for (const m of aboutJuan) console.log(`  [tick ${m.tick}] ${m.text}`)
console.log(`  newest first: ${aboutJuan[0]?.tick === 340 ? 'yes' : 'NO'}`)
console.log(`  scoped to juan only: ${aboutJuan.every((m) => m.about === 'juan') ? 'yes' : 'NO'}`)

const id = await store.identity('marta')
console.log(`\nidentity: ${id.length} — ${id[0]?.text ?? '(none)'}`)

const gossip = (await store.recall('marta', 'pedro'))[0]
console.log(`second-hand flag survives: ${gossip?.secondHand === true ? 'yes' : 'NO'}`)

const today = await store.since('marta', 250)
console.log(`since(tick 250): ${today.length} memories, all episodic: ${today.every((m) => m.kind === 'episodic')}`)
