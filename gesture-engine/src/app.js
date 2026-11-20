import {ParticleField} from './particles.js';
import {SoundField} from './audio.js';
import {classify,Stabilizer,distance} from './gestures.js';
const $=id=>document.getElementById(id),cfg=await fetch('config.json').then(r=>r.json());
let field;try{field=new ParticleField($('stage'),cfg);}catch(e){$('message').textContent='WebGL 初始化失败，请启用浏览器硬件加速：'+e.message;throw e;}
const sound=new SoundField(cfg),stable=new Stabilizer(cfg.tracking),keys=['open','fist','point','pinch','lift','dual'],icons=['≋','✷','ϟ','◎','✧','◉'];
let mode='',source='demo',center={x:0,y:0},tips=Array.from({length:5},()=>({x:0,y:0})),scale=1,worker,ready=false,busy=false,stream,previous=null,previousTime=0,lastInference=0,lastResult=0,autoplay=false,lastAuto=0,frames=0,lastFps=performance.now(),fps=60,requested=cfg.particles.count,slow=0,recording=false,liftUntil=0;
function setMode(next){if(next===mode)return;mode=next;field.setMode(cfg.gestures[mode].effect);$('state').textContent=cfg.gestures[mode].label;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);});}
keys.forEach((key,i)=>{const b=document.createElement('button');b.dataset.mode=key;b.innerHTML=`<span class="icon">${icons[i]}</span><strong>${cfg.gestures[key].label.split(' · ')[0]}</strong><small>${i+1} / ${cfg.gestures[key].label.split(' · ')[1]}</small>`;b.onclick=()=>{useDemo();setMode(key);};$('gestures').append(b);});
function message(s){$('message').textContent=s;}
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;previous=null;}
function useDemo(){source='demo';$('source').value=source;stopCamera();$('hands').textContent='DEMO / 模拟输入';$('latency').textContent='—';message('演示模式 · 鼠标移动中心，滚轮缩放，数字键切换');}
async function startCamera(){if(source==='camera'&&stream)return;autoplay=false;$('autoplay').textContent='自动巡演';$('camera').disabled=true;try{if(!navigator.mediaDevices)throw Error('请使用 localhost 或 HTTPS');message('正在请求摄像头并加载手部模型…');stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});$('video').srcObject=stream;await $('video').play();if(!worker){worker=new Worker(new URL('./tracker-worker.js',import.meta.url));worker.onmessage=({data})=>{if(data.type==='ready'){ready=true;message('模型就绪 · 面向镜头，保持手掌完整可见');}else if(data.type==='error'){ready=false;busy=false;stopCamera();useDemo();message('识别未启动：'+data.message);}else if(data.type==='result'){busy=false;if(source!=='camera')return;lastResult=performance.now();$('latency').textContent=data.latency.toFixed(1);processHands(data);}};worker.onerror=e=>{busy=false;ready=false;useDemo();message('识别 Worker 失败：'+e.message);};worker.postMessage({type:'init',confidence:cfg.tracking.confidence});}source='camera';$('source').value=source;setMode('idle');}catch(e){stopCamera();useDemo();message('摄像头不可用：'+e.message+'。可继续使用演示模式。');}finally{$('camera').disabled=false;}}
function point(p){return{x:(.5-p.x)*2*field.aspect,y:(.5-p.y)*2};}
function processHands(r){const now=performance.now(),hands=r.landmarks;let raw='idle';if(hands.length){const l=hands[0],p=point(l[9]);center=p;tips=[4,8,12,16,20].map(i=>point(l[i]));raw=classify(l,previous,(r.time-previousTime)/1000,cfg.tracking);previous=l[9];previousTime=r.time;
 if(hands.length===2){raw='dual';scale=Math.max(.4,Math.min(2.5,distance(hands[0][9],hands[1][9])*3));const p2=point(hands[1][9]);center={x:(p.x+p2.x)/2,y:(p.y+p2.y)/2};}else scale=1;
 if(raw==='pinch'){const a=point(l[4]),b=point(l[8]);center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};}if(raw==='point')center=point(l[8]);
 $('hands').textContent=r.handedness.map(h=>`${h[0].categoryName} ${(h[0].score*100).toFixed(0)}%`).join(' / ');
 }else{previous=null;$('hands').textContent='未检测到手';}
 if(raw==='lift')liftUntil=now+500;if(raw==='open'&&now<liftUntil)raw='lift';
 setMode(stable.update(raw,now));drawSkeleton(hands);
}
function drawSkeleton(hands){const c=$('skeleton'),ctx=c.getContext('2d');c.width=640;c.height=480;ctx.strokeStyle='#8fffe0';ctx.fillStyle='#fff';const chains=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];for(const l of hands){for(const chain of chains){ctx.beginPath();chain.forEach((id,i)=>ctx[i?'lineTo':'moveTo'](l[id].x*640,l[id].y*480));ctx.stroke();}for(const p of l){ctx.beginPath();ctx.arc(p.x*640,p.y*480,3,0,7);ctx.fill();}}}
$('camera').onclick=startCamera;$('source').onchange=()=>{$('source').value==='camera'?startCamera():useDemo();};
$('audio').onclick=async()=>{try{await sound.toggle();$('audio').textContent=sound.enabled?'关闭合成音效':'开启合成音效';}catch(e){message('音频初始化失败：'+e.message);}};
$('volume').oninput=e=>{const v=+e.target.value/100;sound.volume(v);$('volumeValue').textContent=`${Math.round(v*100)}%`;};
$('density').oninput=e=>{requested=+e.target.value;field.count=requested;$('densityValue').textContent=requested.toLocaleString();};
$('theme').onchange=e=>field.uniforms.theme.value=+e.target.value;
$('preview').onchange=e=>$('monitor').hidden=!e.target.checked;
$('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(e=>message(e.message));
$('autoplay').onclick=()=>{useDemo();autoplay=!autoplay;lastAuto=0;$('autoplay').textContent=autoplay?'停止巡演':'自动巡演';};
window.addEventListener('pointermove',e=>{if(source==='demo'){center={x:(e.clientX/innerWidth-.5)*2*field.aspect,y:(.5-e.clientY/innerHeight)*2};}});
window.addEventListener('wheel',e=>{if(source==='demo')scale=Math.max(.4,Math.min(2.5,scale-e.deltaY*.001));},{passive:true});
window.addEventListener('keydown',e=>{if(/INPUT|SELECT/.test(document.activeElement.tagName))return;if(e.key==='0'){useDemo();setMode('idle');}if(+e.key>=1&&+e.key<=6){useDemo();setMode(keys[+e.key-1]);}});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function captureCanvas(){const c=document.createElement('canvas');c.width=$('stage').width;c.height=$('stage').height;return c;}
function annotate(c){const x=c.getContext('2d');x.drawImage($('stage'),0,0);x.fillStyle='#07101cdd';x.fillRect(16,16,650,82);x.fillStyle='#c7ffeb';x.font='18px sans-serif';x.fillText(`ETHER | ${source==='demo'?'DEMO':'CAMERA'} | ${mode} | ${fps} FPS`,30,47);x.fillText(`Inference: ${$('latency').textContent} ms | Particles: ${field.count}`,30,77);}
$('snapshot').onclick=()=>{const c=captureCanvas();annotate(c);c.toBlob(b=>download(b,`ether-${mode}.png`));};
$('record').onclick=()=>{if(recording)return;if(!window.MediaRecorder){message('浏览器不支持录制，请使用 Chrome / Edge');return;}const c=captureCanvas(),s=c.captureStream(30);if(sound.ctx){const dest=sound.ctx.createMediaStreamDestination();sound.master.connect(dest);s.addTrack(dest.stream.getAudioTracks()[0]);s.cleanup=()=>{sound.master.disconnect(dest);};}const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));const rec=new MediaRecorder(s,mime?{mimeType:mime}:{}),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=()=>{recording=false;s.getTracks().forEach(t=>t.stop());s.cleanup?.();download(new Blob(chunks,{type:rec.mimeType}),'ether-demo.webm');$('record').textContent='录制 10 秒';};recording=true;let id;function frame(){annotate(c);if(recording)id=requestAnimationFrame(frame);}frame();rec.start();$('record').textContent='正在录制…';setTimeout(()=>{rec.stop();cancelAnimationFrame(id);},10000);};
let last=performance.now();setMode('pinch');function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.1);last=now;frames++;
 if(now-lastFps>=1000){fps=Math.round(frames*1000/(now-lastFps));$('fps').textContent=fps;frames=0;lastFps=now;if(fps<32)slow++;else slow=Math.max(0,slow-1);if(slow>=2){field.count=Math.max(cfg.particles.minimum,Math.round(field.count*.8));slow=0;}else if(fps>55&&field.count<requested)field.count=Math.min(requested,field.count+500);$('particleCount').textContent=(field.count/1000).toFixed(1)+'K';}
 if(source==='demo'){if(autoplay&&now-lastAuto>3500){setMode(keys[(keys.indexOf(mode)+1)%keys.length]);lastAuto=now;}for(let i=0;i<5;i++)tips[i]={x:center.x+(i-2)*.1,y:center.y+Math.sin(now*.001+i)*.12};}
 if(source==='camera'){if(now-lastResult>cfg.tracking.lostMs)setMode(stable.update('idle',now));if(ready&&!busy&&$('video').readyState>=2&&now-lastInference>1000/cfg.tracking.inferenceFps){busy=true;lastInference=now;createImageBitmap($('video')).then(bitmap=>{if(source!=='camera'){bitmap.close();busy=false;return;}worker.postMessage({type:'frame',bitmap,time:now},[bitmap]);}).catch(e=>{busy=false;message(e.message);});}}
 sound.update(mode,scale);field.draw(now/1000,dt,center,tips,scale);
 window.etherMetrics={fps,mode,source,particles:field.count,inferenceMs:source==='camera'?+$('latency').textContent:null};
}requestAnimationFrame(animate);
window.addEventListener('pagehide',()=>{stopCamera();worker?.terminate();sound.ctx?.close();});

