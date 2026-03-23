type EnumMap<T extends readonly string[]> = {
  [K in T[number] as Uppercase<K>]: K;
};

export function createEnumMap<T extends readonly string[]>(
  values: T
): EnumMap<T> {
  const entries = values.map((v) => [v.toUpperCase(), v] as const);
  return Object.fromEntries(entries) as EnumMap<T>;
}
