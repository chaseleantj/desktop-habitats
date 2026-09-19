import { randomGenerator, clamp } from './math.js';

export const REACH=.90;
const GOLDEN=Math.PI*(3-Math.sqrt(5)),ROOT_RADIUS=.24;

// The host deliberately retains its authored silhouette. Compact is an explicit shape
// choice, not a claim that every small/juvenile anemone has short tentacles. Real species
// and expansion states differ. All lengths here are in tank units.
export function crownProfile(spec){
  const S=spec.radius/REACH,compact=spec.form==='compact';
  const cycles=compact?(S>.65?[6,6,12,24,48]:S>.40?[6,6,12,24]:[6,6,12]):null;
  return {S,compact,rim:compact?.53:.36,height:compact?.43:.66,
    count:compact?cycles.reduce((a,b)=>a+b,0):Math.round(110*Math.pow(S,1.3)),cycles};
}

export function buildCrown(spec,index=0){
  const profile=crownProfile(spec),{S,compact,count,cycles,rim}=profile;
  // Separate streams: editing one little crown cannot reshuffle the finished host.
  const rng=randomGenerator(8945+index*977),roots=[];
  if(!compact){
    for(let i=0;i<count;i++){
      const rr=Math.sqrt(ROOT_RADIUS*ROOT_RADIUS+(1-ROOT_RADIUS*ROOT_RADIUS)*(i+.5)/count),ring=(rr-ROOT_RADIUS)/(1-ROOT_RADIUS);
      const angle=i*GOLDEN+(rng()-.5)*.44,radius=clamp(rr+(rng()-.5)*.10,ROOT_RADIUS*.9,1);
      const length=.48*Math.pow(S,1.15)*(.88+.50*ring)*(.86+.28*rng()),girth=.036*Math.pow(S,.70)*(.85+.30*rng());
      const tilt=.25+.75*Math.pow(ring,1.2),curl=(.20+.80*rng())*(.60+.75*ring);
      roots.push({angle,radius,ring,length,girth,tilt,curl,tone:rng(),lag:rng(),seed:rng(),flex:1});
    }
  }else{
    // Successive, staggered tentacle cycles around a bare oral centre, not random spines
    // on a sphere. The small angular/radial jitter removes a machined rosette appearance.
    // Inner tentacles are a little longer; the outer ones form a short, outward skirt.
    const radii=cycles.length===5?[.26,.38,.52,.68,.89]:cycles.length===4?[.31,.47,.66,.89]:[.35,.60,.88];
    const turn=rng()*Math.PI*2,diameter=2*rim*S;
    cycles.forEach((n,c)=>{
      for(let i=0;i<n;i++){
        const ring=c/(cycles.length-1),angle=turn+(i+(c%2)*.5+(rng()-.5)*.23)*Math.PI*2/n;
        const radius=radii[c]+(rng()-.5)*.022;
        const length=diameter*(.43-.14*ring)*(.90+.20*rng());
        roots.push({angle,radius,ring,length,girth:diameter*.044*(.88+.22*rng()),
          tilt:.20+.68*ring+(rng()-.5)*.10,curl:.13+.24*rng(),tone:rng(),lag:rng(),seed:rng(),flex:.46+.12*rng()});
      }
    });
    // Density and diameter must agree. Cap root radii to the nearest neighbour spacing;
    // otherwise densely packed crowns fuse into one lump where the tentacles emerge.
    for(const a of roots){
      let near=Infinity;
      for(const b of roots)if(a!==b)near=Math.min(near,Math.hypot(Math.cos(a.angle)*a.radius-Math.cos(b.angle)*b.radius,Math.sin(a.angle)*a.radius-Math.sin(b.angle)*b.radius)*rim*S);
      a.girth=Math.min(a.girth,near*.42);
    }
  }
  return {...profile,roots};
}

// Farthest-point ordering makes every prefix spatially balanced. Arbitrarily dropping
// every nth instance left small crowns with holes and could under-sample an entire one.
export function crownOrder(roots){
  const order=[],used=new Uint8Array(roots.length),distance=new Float64Array(roots.length).fill(Infinity);
  let next=0;
  for(let n=0;n<roots.length;n++){
    order.push(next);used[next]=1;const a=roots[next];
    for(let i=0;i<roots.length;i++)if(!used[i]){
      const b=roots[i],d=(Math.cos(a.angle)*a.radius-Math.cos(b.angle)*b.radius)**2+(Math.sin(a.angle)*a.radius-Math.sin(b.angle)*b.radius)**2;
      distance[i]=Math.min(distance[i],d);
    }
    next=-1;for(let i=0;i<roots.length;i++)if(!used[i]&&(next<0||distance[i]>distance[next]))next=i;
  }
  return order;
}

export function crownBudget(crown,quality){
  const fraction=quality==='eco'?.57:quality==='balanced'?.70:1;
  return Math.min(crown.count,Math.max(crown.compact?36:0,Math.round(crown.count*fraction)));
}
