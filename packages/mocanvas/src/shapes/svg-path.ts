import { PATH_OP } from "@mocanvas/editor"

function num(v: number | undefined): string {
  const n = v ?? 0
  return String(Math.round(n * 100) / 100)
}

/** Convert the engine's flat path encoding to an SVG `d` attribute (for indicators). */
export function pathWordsToSvgD(words: readonly number[]): string {
  const parts: string[] = []
  let i = 0
  while (i < words.length) {
    const op = words[i]
    switch (op) {
      case PATH_OP.MOVE:
        parts.push(`M${num(words[i + 1])} ${num(words[i + 2])}`)
        i += 3
        break
      case PATH_OP.LINE:
        parts.push(`L${num(words[i + 1])} ${num(words[i + 2])}`)
        i += 3
        break
      case PATH_OP.QUAD:
        parts.push(`Q${num(words[i + 1])} ${num(words[i + 2])} ${num(words[i + 3])} ${num(words[i + 4])}`)
        i += 5
        break
      case PATH_OP.CUBIC:
        parts.push(
          `C${num(words[i + 1])} ${num(words[i + 2])} ${num(words[i + 3])} ${num(words[i + 4])} ${num(words[i + 5])} ${num(words[i + 6])}`,
        )
        i += 7
        break
      case PATH_OP.CLOSE:
        parts.push("Z")
        i += 1
        break
      default:
        // Malformed stream: stop rather than emit garbage.
        return parts.join(" ")
    }
  }
  return parts.join(" ")
}
