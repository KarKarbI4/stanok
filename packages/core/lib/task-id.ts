export function parseTaskId(input: string): string | null {
  if (!input.trim()) return null;
  const urlMatch = input.match(/\/browse\/([A-Z][\w]*-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  const idMatch = input.trim().match(/^([A-Z][\w]*-\d+)$/i);
  if (idMatch) return idMatch[1].toUpperCase();
  return null;
}
