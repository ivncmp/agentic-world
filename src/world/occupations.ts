/**
 * What people do for a living: where they work, what it pays, when their shift
 * is. Independent of employment — an unemployed engineer is still an engineer
 * and looks for engineering work.
 *
 * Wages are per hour and set against rent, so a job comfortably covers living
 * costs and idleness does not.
 */
import type { LocationKind } from './locations.js'

/**
 * What an agent *is*, independent of whether they currently hold a job. An
 * unemployed engineer is still an engineer and looks for engineering work.
 *
 * Wages differ on purpose: DESIGN.md leans on income inequality as a conflict
 * source, and a world where everyone earns the same generates none.
 */
/** Where this job is done, what it pays per hour, and when the shift runs. */
export type OccupationDef = {
  label: string
  /** Where this occupation is practised. */
  worksAt: LocationKind
  wage: number
  shiftStart: number
  shiftEnd: number
  /** Days of the week this occupation works. 0 = Sunday, 6 = Saturday. */
  workDays: readonly number[]
}

const MON_FRI = [1, 2, 3, 4, 5] as const
const MON_SAT = [1, 2, 3, 4, 5, 6] as const
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const

/** The closed catalogue. Each entry needs a venue kind that actually exists. */
export const OCCUPATIONS = {
  student: { label: 'Student', worksAt: 'school', wage: 2, shiftStart: 9, shiftEnd: 15, workDays: MON_FRI },
  teacher: { label: 'Teacher', worksAt: 'school', wage: 15, shiftStart: 8, shiftEnd: 16, workDays: MON_FRI },
  engineer: {
    label: 'Engineer',
    worksAt: 'office',
    wage: 24,
    shiftStart: 9,
    shiftEnd: 18,
    workDays: MON_FRI,
  },
  manager: { label: 'Manager', worksAt: 'office', wage: 30, shiftStart: 8, shiftEnd: 18, workDays: MON_FRI },
  clerk: { label: 'Clerk', worksAt: 'office', wage: 11, shiftStart: 9, shiftEnd: 17, workDays: MON_FRI },
  doctor: { label: 'Doctor', worksAt: 'clinic', wage: 34, shiftStart: 8, shiftEnd: 17, workDays: MON_SAT },
  nurse: { label: 'Nurse', worksAt: 'clinic', wage: 17, shiftStart: 7, shiftEnd: 15, workDays: MON_SAT },
  cashier: {
    label: 'Cashier',
    worksAt: 'supermarket',
    wage: 9,
    shiftStart: 10,
    shiftEnd: 18,
    workDays: EVERY_DAY,
  },
  shopkeeper: {
    label: 'Shopkeeper',
    worksAt: 'shop',
    wage: 13,
    shiftStart: 10,
    shiftEnd: 19,
    workDays: EVERY_DAY,
  },
  bartender: {
    label: 'Bartender',
    worksAt: 'bar',
    wage: 10,
    shiftStart: 17,
    shiftEnd: 24,
    workDays: EVERY_DAY,
  },
  mechanic: {
    label: 'Mechanic',
    worksAt: 'garage',
    wage: 16,
    shiftStart: 8,
    shiftEnd: 17,
    workDays: MON_SAT,
  },
  trainer: { label: 'Trainer', worksAt: 'gym', wage: 12, shiftStart: 7, shiftEnd: 15, workDays: MON_SAT },
} as const satisfies Record<string, OccupationDef>

/** Derived from the catalogue's keys, so an unknown occupation fails to compile. */
export type Occupation = keyof typeof OCCUPATIONS

/** The definition behind an agent's occupation. */
export const occupationDef = (o: Occupation): OccupationDef => OCCUPATIONS[o]
/** Every occupation, for validation and for the agent-creation UI. */
export const ALL_OCCUPATIONS = Object.keys(OCCUPATIONS) as Occupation[]
