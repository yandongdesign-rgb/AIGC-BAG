import * as THREE from '../vendor/three.module.js';
const vertex=`
attribute vec4 seed; uniform float time, size, scale, theme, burst; uniform vec2 center; uniform vec2 tips[5]; uniform float weights[6]; varying vec3 tint; varying float alpha;
void main(){
 float a=seed.x*6.2831853;float life=fract(seed.z+time*(.08+seed.w*.1));float r=sqrt(seed.y);vec2 dir=vec2(cos(a),sin(a));
 vec2 idle=vec2((seed.x-.5)*3.8,(seed.y-.5)*2.4);idle+=vec2(sin(time*.13+a),cos(time*.1+a))*.11;
 float angle=a+time*(.35+1.7*(1.-r));vec2 vortex=center+vec2(cos(angle),sin(angle))*(.1+r*.78)*scale*vec2(1.,.46);vortex.y+=sin(angle*3.+time)*.035;
 vec2 trail=tips[int(mod(seed.x*100.,5.))]+vec2(sin(a+life*9.)*.09,-life*.7)+dir*seed.w*.025;
 float age=max(0.,time-burst);vec2 explosion=center+dir*(.025+min(age,3.)*(.25+seed.y*1.2))*scale;explosion.y-=age*age*.13;
 vec2 floating=center+dir*r*1.05*scale+vec2(sin(time*.7+a)*.13,fract(seed.z+time*.09)*1.6-.8);
 float branch=floor(seed.y*5.);vec2 target=vec2(sin(branch*8.)*.9,cos(branch*3.)*.7);float zig=sin(seed.x*150.+floor(time*18.)*7.+branch)*.028;vec2 bolt=mix(center,target,seed.x)+vec2(zig,zig*.7);
 vec2 p=idle*weights[0]+trail*weights[1]+explosion*weights[2]+bolt*weights[3]+vortex*weights[4]+floating*weights[5];
 float hue=a+theme*2.;tint=.55+.45*cos(vec3(0.,2.,4.)+hue+vec3(time*.08));tint=mix(tint,vec3(.55,.77,1.),weights[3]*.7);
 alpha=(.35+.65*sin(life*3.14159))*(1.-weights[2]*min(age*.27,.9));
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,0.,1.);gl_PointSize=size*(1.2+seed.w*2.5)*(1.+weights[3]*.5);
}`;
const fragment=`varying vec3 tint;varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float glow=exp(-d*d*5.)*(1.-d);gl_FragColor=vec4(tint,glow*alpha*.72);}`;
export class ParticleField{
 constructor(canvas,config){this.canvas=canvas;this.cfg=config;this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true,alpha:false});this.renderer.setClearColor(0x050810);this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);this.camera.position.z=2;const max=56000,g=new THREE.BufferGeometry(),seeds=new Float32Array(max*4);for(let i=0;i<seeds.length;i++)seeds[i]=Math.random();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(max*3),3));g.setAttribute('seed',new THREE.BufferAttribute(seeds,4));this.geometry=g;this.uniforms={time:{value:0},size:{value:2},scale:{value:1},theme:{value:0},burst:{value:-10},center:{value:new THREE.Vector2()},tips:{value:Array.from({length:5},()=>new THREE.Vector2())},weights:{value:[0,0,0,0,1,0]}};const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});this.scene.add(new THREE.Points(g,material));this.target=[0,0,0,0,1,0];this.count=config.particles.count;this.resize();window.addEventListener('resize',()=>this.resize());}
 resize(){const w=innerWidth,h=innerHeight;this.aspect=w/h;this.camera.left=-this.aspect;this.camera.right=this.aspect;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.cfg.particles.pixelRatio));this.renderer.setSize(w,h);this.uniforms.size.value=2*this.renderer.getPixelRatio();}
 setMode(effect){const map={ambient:0,trail:1,burst:2,lightning:3,vortex:4,float:5};this.target=[0,0,0,0,0,0];this.target[map[effect]??0]=1;if(effect==='lightning'){this.target[3]=.85;this.target[1]=.15;}if(effect==='burst')this.uniforms.burst.value=this.uniforms.time.value;}
 draw(t,dt,center,tips,scale){const u=this.uniforms;u.time.value=t;const k=1-Math.exp(-dt/this.cfg.particles.transitionSeconds*3);u.center.value.lerp(new THREE.Vector2(center.x,center.y),k);u.scale.value+=(scale-u.scale.value)*k;for(let i=0;i<6;i++)u.weights.value[i]+=(this.target[i]-u.weights.value[i])*k;for(let i=0;i<5;i++)u.tips.value[i].lerp(new THREE.Vector2(tips[i].x,tips[i].y),k);this.geometry.setDrawRange(0,this.count);this.renderer.render(this.scene,this.camera);}
}
