import { Capacitor } from '@capacitor/core';

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';

export async function exportNativeJson(name: string, json: string) {
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'), import('@capacitor/share'),
  ]);
  const result = await Filesystem.writeFile({
    path: `VaultTerminal/${name}`,
    data: json,
    directory: Directory.Documents,
    recursive: true,
  });
  if ((await Share.canShare()).value) {
    await Share.share({ title: 'Экспорт Vault Terminal', files: [result.uri] });
  }
  return result.uri;
}
