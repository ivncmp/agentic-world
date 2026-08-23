/**
 * Generates fully-baked city template JSONs from CityConfig definitions.
 * Run: npx tsx src/dev/bake-cities.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCity, exportTemplate } from '../world/generator.js'
import type { CityConfig } from '../world/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const citiesDir = resolve(__dirname, '../world/cities')

const CITIES: { file: string; config: CityConfig; seed: number }[] = [
  {
    file: 'newAgentown.json',
    seed: 42,
    config: {
      name: 'New Agentown',
      blocksPerSide: 5,
      districts: ['Centro', 'Ribera', 'Altos', 'Puerto', 'Norte'],
      venues: {
        bar: 2, office: 2, shop: 1, supermarket: 1, clinic: 1,
        school: 1, gym: 1, park: 2, garage: 1, cinema: 1, bowling: 1, cafe: 1,
      },
      openingsPerWorkplace: 3,
    },
  },
  {
    file: 'saintSkill.json',
    seed: 77,
    config: {
      name: 'Saint Skill',
      blocksPerSide: 4,
      districts: ['Old Quarter', 'Dockside', 'Hillcrest', 'Ironworks'],
      venues: {
        bar: 3, office: 1, shop: 2, supermarket: 1, clinic: 1,
        school: 1, gym: 1, park: 1, garage: 1, cinema: 1, cafe: 2,
      },
      openingsPerWorkplace: 2,
    },
  },
]

const VENUE_NAMES: Record<string, Record<string, readonly string[]>> = {
  newAgentown: {
    bar: ['The Anchor', 'La Tasca'],
    office: ['Nortec', 'Delgado & Co'],
    shop: ['La Esquina'],
    supermarket: ['MercaVall'],
    clinic: ['Clínica Santa Rosa'],
    school: ['IES New Agentown'],
    gym: ['Gimnasio Titán'],
    park: ['Parque del Puerto', 'Jardines Ribera'],
    garage: ['Talleres Ruiz'],
    cinema: ['Cines New Agentown'],
    bowling: ['Bolera Strike'],
    cafe: ['Café Rincón'],
  },
  saintSkill: {
    bar: ['The Rusty Nail', 'Dockside Tavern', 'The Forge'],
    office: ['Blackwell & Sons'],
    shop: ['Hillcrest Goods', 'The Iron Market'],
    supermarket: ['Harbour Fresh'],
    clinic: ['St. Skill Infirmary'],
    school: ['Ironworks Academy'],
    gym: ['The Furnace Gym'],
    park: ['Hilltop Gardens'],
    garage: ['Cranks & Bolts'],
    cinema: ['The Lantern Cinema'],
    cafe: ['Bean & Anvil', 'The Morning Press'],
  },
}

for (const { file, config, seed } of CITIES) {
  const key = file.replace('.json', '')
  const names = VENUE_NAMES[key]
  const city = generateCity(config, seed, names)
  const template = exportTemplate(city, seed)
  const path = resolve(citiesDir, file)
  writeFileSync(path, JSON.stringify(template, null, 2) + '\n')
  console.log(`${file}: ${template.venues.length} venues, ${template.homePlots.length} home plots, ${template.blocks.length} blocks`)
}
