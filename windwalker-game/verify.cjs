const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('index.html','utf8');const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const noop=()=>{};const gradient={addColorStop:noop};const ctx=new Proxy({createLinearGradient:()=>gradient},{get:(o,k)=>o[k]||noop,set:(o,k,v)=>(o[k]=v,true)});
const nodes={};const node=()=>({classList:{add:noop,remove:noop},getContext:()=>ctx});
const sandbox={console,Math,Set,innerWidth:1280,innerHeight:720,devicePixelRatio:1,addEventListener:noop,requestAnimationFrame:noop,document:{querySelector:s=>nodes[s]||(nodes[s]=node()),querySelectorAll:()=>[]}};
vm.createContext(sandbox);vm.runInContext(code,sandbox);
vm.runInContext(`
init(); draw();
press('jump');step(.016);if(player.y>=ground)throw Error('Jump failed');keys.jump=false;
for(let i=0;i<100;i++)step(.016);if(!player.grounded)throw Error('Landing failed');
keys.duck=true;step(.016);if(!player.duck)throw Error('Duck failed');keys.duck=false;
player.x=450;enemies[0].x=510;press('attack');step(.016);if(enemies[0].hp!==1)throw Error('Sword failed');
step(.016);if(enemies[0].hp!==1)throw Error('Duplicate swing hit');
player.inv=0;let before=player.hp;damage();damage();if(player.hp!==before-1)throw Error('Invulnerability failed');
player.inv=0;player.duck=true;keys.duck=true;player.x=300;arrows=[{x:300,y:ground-44,vx:0}];before=player.hp;step(.016);if(player.hp!==before)throw Error('Ducking arrow failed');
keys.duck=false;player.inv=0;step(.016);if(player.hp!==before-1)throw Error('Arrow collision failed');
for(let n=0;n<3;n++){init(n);enemies.forEach(e=>e.hp=0);player.x=lengths[n]-70;step(.016);if(mode!==(n===2?'win':'clear'))throw Error('Level completion failed');draw();}
console.log('PASS: jump, landing, duck, sword, single hit, damage immunity, arrow collision, all three level exits.');
`,sandbox);
