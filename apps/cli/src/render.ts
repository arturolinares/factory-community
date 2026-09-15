import { formatProblem, type Problem } from '@factory/core'

/**
 * Output helpers.
 *
 * Colour follows NO_COLOR and is off whenever output is not a terminal, so
 * piping to a file or a CI log gives plain text. Nothing here decides what to
 * say -- commands do that -- only how it looks.
 */
export interface Style {
  readonly dim: (text: string) => string
  readonly bold: (text: string) => string
  readonly red: (text: string) => string
  readonly yellow: (text: string) => string
  readonly green: (text: string) => string
}

const ESC = String.fromCharCode(27)
const wrap = (code: string) => (text: string) => `${ESC}[${code}m${text}${ESC}[0m`

const plain: Style = {
  dim: (t) => t,
  bold: (t) => t,
  red: (t) => t,
  yellow: (t) => t,
  green: (t) => t,
}

const coloured: Style = {
  dim: wrap('2'),
  bold: wrap('1'),
  red: wrap('31'),
  yellow: wrap('33'),
  green: wrap('32'),
}

export function styleFor(options: {
  env: Readonly<Record<string, string | undefined>>
  isTty: boolean
}): Style {
  if (options.env.NO_COLOR !== undefined && options.env.NO_COLOR !== '') return plain
  if (options.env.FORCE_COLOR !== undefined && options.env.FORCE_COLOR !== '') return coloured
  return options.isTty ? coloured : plain
}

export function renderProblem(problem: Problem, style: Style): string {
  const text = formatProblem(problem)
  return problem.severity === 'error' ? style.red(text) : style.yellow(text)
}

/** Pad columns, leaving the last ragged so one long value cannot skew a table. */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length)
    })
  }
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd(),
  )
}
