import { DBrainClient } from '@dtoolkit/sdk'

const c = new DBrainClient({
  baseUrl: process.env.DBRAIN_URL ?? 'http://localhost:7978',
  token: process.env.DBRAIN_TOKEN ?? '',
})

const ids = [
  'marta-reyes',
  'juan-ortega',
  'lucia-chen',
  'pedro-vasquez',
  'sara-nilsson',
  'michael-morris',
  'laura-mcgonaghal',
  'peter-file',
  'john-beabery',
]

async function main() {
  for (const id of ids) {
    try {
      const e = await c.getEntity(id)
      const facts = e.facts.filter((f: { category?: string }) => f.category === 'identity')
      console.log(`${id}: ${facts.length} identity facts`)
    } catch {
      console.log(`${id}: NOT FOUND`)
    }
  }
}
void main()
