const listeners: Array<() => void> = []

export function onThemeChange(fn: () => void): void {
  listeners.push(fn)
}

function fire(): void {
  for (const fn of listeners) fn()
}

export function isLight(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light'
}

export function cssHex(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return parseInt(raw.replace('#', ''), 16)
}

const btn = document.getElementById('theme-toggle')
btn?.addEventListener('click', () => {
  requestAnimationFrame(fire)
})
