// Run once with sharp installed to regenerate the PWA icons from the code-native SVG.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_PATH || 'sharp');
for(const size of [192,512])await sharp('apps/web/public/icon.svg').resize(size,size).png().toFile(`apps/web/public/icon-${size}.png`);
const androidSizes={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const [density,size] of Object.entries(androidSizes)) {
  const folder=join('apps/android/app/src/main/res','mipmap-'+density);
  await mkdir(folder,{recursive:true});
  for(const name of ['ic_launcher','ic_launcher_round','ic_launcher_foreground']) {
    await sharp('apps/web/public/icon.svg').resize(size,size).png().toFile(join(folder,name+'.png'));
  }
}
