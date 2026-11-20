import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const assets=[
 ['vendor/hand_landmarker.task','https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task','fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'],
 ['vendor/wasm/vision_wasm_internal.wasm','https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm/vision_wasm_internal.wasm','f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7'],
 ['vendor/wasm/vision_wasm_nosimd_internal.wasm','https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm/vision_wasm_nosimd_internal.wasm','3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4']
];
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function ensureDependencies(){for(const [name,url,sha]of assets){const target=new URL(name,import.meta.url);try{if(hash(await readFile(target))===sha)continue;}catch{}console.log('Downloading '+name);const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Dependency download failed: '+response.status+' '+url);const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==sha)throw Error('SHA-256 mismatch: '+name);await mkdir(new URL('.',target),{recursive:true});const temp=new URL(target.href+'.download');await writeFile(temp,bytes);await rename(temp,target);}console.log('Dependencies verified.');}
if(process.argv[1]&&new URL('file:///'+process.argv[1].replaceAll('\\','/')).href===import.meta.url)await ensureDependencies();
