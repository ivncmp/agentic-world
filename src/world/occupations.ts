import type { LocationKind } from './locations.js'

/**
 * What an agent *is*, independent of whether they currently hold a job. An
 * unemployed engineer is still an engineer and looks for engineering work.
 *
 * Wages differ on purpose: DESIGN.md leans on income inequality as a conflict
 * source, and a world where everyone earns the same generates none.
 */
export type OccupationDef = {
  label: string
  /** Where this occupation is practised. */
  worksAt: LocationKind
  wage: number
  shiftStart: number
  shiftEnd: number
}

export const OCCUPATIONS = {
  student: { label: 'Student', worksAt: 'school', wage: 2, shiftStart: 9, shiftEnd: 15 },
  teacher: { label: 'Teacher', worksAt: 'school', wage: 15, shiftStart: 8, shiftEnd: 16 },
  engineer: { label: 'Engineer', worksAt: 'office', wage: 24, shiftStart: 9, shiftEnd: 18 },
  manager: { label: 'Manager', worksAt: 'office', wage: 30, shiftStart: 8, shiftEnd: 18 },
  clerk: { label: 'Clerk', worksAt: 'office', wage: 11, shiftStart: 9, shiftEnd: 17 },
  doctor: { label: 'Doctor', worksAt: 'clinic', wage: 34, shiftStart: 8, shiftEnd: 17 },
  nurse: { label: 'Nurse', worksAt: 'clinic', wage: 17, shiftStart: 7, shiftEnd: 15 },
  cashier: { label: 'Cashier', worksAt: 'supermarket', wage: 9, shiftStart: 10, shiftEnd: 18 },
  shopkeeper: { label: 'Shopkeeper', worksAt: 'shop', wage: 13, shiftStart: 10, shiftEnd: 19 },
  bartender: { label: 'Bartender', worksAt: 'bar', wage: 10, shiftStart: 17, shiftEnd: 24 },
  mechanic: { label: 'Mechanic', worksAt: 'garage', wage: 16, shiftStart: 8, shiftEnd: 17 },
  trainer: { label: 'Trainer', worksAt: 'gym', wage: 12, shiftStart: 7, shiftEnd: 15 },
} as const satisfies Record<string, OccupationDef>

export type Occupation = keyof typeof OCCUPATIONS

export const occupationDef = (o: Occupation): OccupationDef => OCCUPATIONS[o]
export const ALL_OCCUPATIONS = Object.keys(OCCUPATIONS) as Occupation[]
