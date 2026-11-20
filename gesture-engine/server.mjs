import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ensureDependencies} from './setup-deps.mjs';
await ensureDependencies();
const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.task':'application/octet-stream'};
http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(p!==root.slice(0,-1)&&!p.startsWith(root))throw Error();const file=p===root.slice(0,-1)||p===root?path.join(root,'index.html'):p;res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end('Not found');}}).listen(8731,'127.0.0.1',()=>console.log('Local: http://localhost:8731'));


