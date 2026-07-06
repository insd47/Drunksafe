import Storage from 'expo-sqlite/kv-store';

export async function readJson<T>(
  key: string,
  fallback: () => T,
  isValue: (value: unknown) => value is T,
  sanitizeValue?: (value: unknown) => T | null
) {
  const value = await Storage.getItem(key);

  if (!value) {
    return fallback();
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (isValue(parsed)) {
      return parsed;
    }

    const sanitized = sanitizeValue?.(parsed);

    if (sanitized) {
      await writeJson(key, sanitized);
      return sanitized;
    }
  } catch {
    // Corrupt JSON is cleared below.
  }

  await Storage.removeItem(key);
  return fallback();
}

export async function writeJson<T>(key: string, value: T) {
  await Storage.setItem(key, JSON.stringify(value));
}

export async function removeJson(key: string) {
  await Storage.removeItem(key);
}
