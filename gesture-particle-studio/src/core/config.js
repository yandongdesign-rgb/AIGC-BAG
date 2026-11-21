const FILES = ['gestures', 'recognition', 'particles', 'audio'];

export async function loadConfig(base = import.meta.env?.BASE_URL ?? './') {
  const entries = await Promise.all(
    FILES.map(async (name) => {
      const res = await fetch(`${base}config/${name}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`无法加载配置 config/${name}.json (${res.status})`);
      return [name, await res.json()];
    }),
  );
  return Object.fromEntries(entries);
}
