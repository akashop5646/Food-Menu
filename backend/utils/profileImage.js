export function normalizeProfileImage(value) {
  if (typeof value !== 'string') return null;
  const imageUrl = value.trim();
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
