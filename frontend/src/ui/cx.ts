// Tiny classname joiner: drops falsy parts so conditional modifiers stay terse.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
