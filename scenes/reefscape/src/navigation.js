import * as THREE from 'three';
import { groundHeight } from './math.js';
import { ROCKS, CORAL_BOUNDS, ANEMONES, TANK } from './layout.js';

// A small, shared visibility graph, built once, not a per-frame path finder. The whole
// water column is available; only actual hardscape, crowns and tank edges are excluded.
// Home coral is a refuge during an alarm, never the centre of a roaming territory.
export const SWIM_BOUNDS={x:[-8.1,8.1],y:[1.1,7.45],z:[-2.85,4.85]};
const MARGIN=.48;
const obstacles=[...ROCKS,...CORAL_BOUNDS,...ANEMONES.map(a=>
  [a.x,a.y+.22,a.z,a.radius+.16,a.radius*.62+.18,a.radius+.16])];
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

export function clearWater(p,margin=MARGIN){
  if(p.x<TANK.left+margin||p.x>TANK.right-margin||p.z<TANK.back+margin||p.z>TANK.front-margin||p.y>TANK.surface-margin||p.y<groundHeight(p.x,p.z)+margin)return false;
  return obstacles.every(o=>Math.hypot((p.x-o[0])/(o[3]+margin),(p.y-o[1])/(o[4]+margin),(p.z-o[2])/(o[5]+margin))>=1);
}

export function clearSegment(a,b,margin=MARGIN){
  // Analytic closest point in each expanded ellipsoid's unit-sphere coordinates: unlike
  // a handful of point samples this cannot miss a thin coral between two waypoints.
  for(const o of obstacles){
    const x=(a.x-o[0])/(o[3]+margin),y=(a.y-o[1])/(o[4]+margin),z=(a.z-o[2])/(o[5]+margin);
    const dx=(b.x-a.x)/(o[3]+margin),dy=(b.y-a.y)/(o[4]+margin),dz=(b.z-a.z)/(o[5]+margin);
    const d=dx*dx+dy*dy+dz*dz,t=d>1e-10?Math.max(0,Math.min(1,-(x*dx+y*dy+z*dz)/d)):0;
    if((x+t*dx)**2+(y+t*dy)**2+(z+t*dz)**2<1)return false;
  }
  for(let i=0;i<=4;i++){
    const t=i/4,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    if(a.y+(b.y-a.y)*t<groundHeight(x,z)+margin)return false;
  }
  return true;
}

export class ReefNavigation {
  constructor(){
    this.nodes=[];
    for(const x of [-7.8,-5.6,-3.4,-1.15,1.15,3.4,5.6,7.8])
      for(const y of [1.25,2.75,4.3,5.9,7.3])
        for(const z of [-2.7,-.65,1.45,3.5,4.65]){
          const p=V(x,y,z);if(x>=SWIM_BOUNDS.x[0]&&x<=SWIM_BOUNDS.x[1]&&y>=SWIM_BOUNDS.y[0]&&y<=SWIM_BOUNDS.y[1]&&z>=SWIM_BOUNDS.z[0]&&z<=SWIM_BOUNDS.z[1]&&clearWater(p))this.nodes.push(p);
        }
    this.edges=this.nodes.map(()=>[]);
    for(let i=0;i<this.nodes.length;i++)for(let j=i+1;j<this.nodes.length;j++){
      const d=this.nodes[i].distanceTo(this.nodes[j]);
      if(d<=4.6&&clearSegment(this.nodes[i],this.nodes[j])){
        this.edges[i].push([j,d]);this.edges[j].push([i,d]);
      }
    }
  }
  destination(from,sector,random){
    // Visit different thirds in succession, but choose depth and height anew. This is
    // a coverage policy, not a repeated spline/lap shared by every animal.
    let choices=this.nodes.filter(p=>(sector===0?p.x<-4:sector===2?p.x>4:Math.abs(p.x)<3.5)&&p.distanceToSquared(from)>16);
    if(!choices.length)choices=this.nodes.filter(p=>p.distanceToSquared(from)>9);
    return choices[Math.floor(random()*choices.length)].clone();
  }
  route(from,to){
    if(clearWater(to)&&clearSegment(from,to))return [to.clone()];
    const n=this.nodes.length,dist=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),used=new Uint8Array(n);
    // Attach to visible graph nodes, keeping graph work out of the render loop. An animal
    // initially inside an old authored shelter can leave it via the nearest safe node;
    // normal avoidance and nonpenetration remain active during that short recovery.
    let attached=false;
    for(let i=0;i<n;i++)if(clearSegment(from,this.nodes[i])){dist[i]=from.distanceTo(this.nodes[i]);attached=true;}
    if(!attached){let near=0;for(let i=1;i<n;i++)if(from.distanceToSquared(this.nodes[i])<from.distanceToSquared(this.nodes[near]))near=i;dist[near]=from.distanceTo(this.nodes[near]);}
    let end=-1,best=Infinity;
    const visible=this.nodes.map(p=>clearWater(to)&&clearSegment(p,to));
    for(let k=0;k<n;k++){
      let u=-1;for(let i=0;i<n;i++)if(!used[i]&&(u<0||dist[i]<dist[u]))u=i;
      if(u<0||!Number.isFinite(dist[u])||dist[u]>=best)break;
      used[u]=1;
      if(visible[u]){const cost=dist[u]+this.nodes[u].distanceTo(to);if(cost<best){best=cost;end=u;}}
      for(const [v,d] of this.edges[u])if(dist[u]+d<dist[v]){dist[v]=dist[u]+d;prev[v]=u;}
    }
    // A moving flock offset can be inside coral even though its centre is clear. End at
    // the nearest reachable water node instead of silently steering into that coral.
    if(end<0){for(let i=0;i<n;i++)if(Number.isFinite(dist[i])&&(end<0||this.nodes[i].distanceToSquared(to)<this.nodes[end].distanceToSquared(to)))end=i;}
    if(end<0)return [from.clone()];
    const path=[];for(let i=end;i>=0;i=prev[i])path.push(this.nodes[i].clone());path.reverse();
    if(visible[end])path.push(to.clone());
    // Greedy line-of-sight shortening removes grid zigzags without cutting through rock.
    const smooth=[];let at=from;
    for(let i=0;i<path.length;){let j=path.length-1;while(j>i&&!clearSegment(at,path[j]))j--;smooth.push(path[j]);at=path[j];i=j+1;}
    return smooth;
  }
}
let shared;
export const reefNavigation=()=>shared||(shared=new ReefNavigation());
