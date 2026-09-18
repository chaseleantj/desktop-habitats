"""Bake porous limestone once, never on the wallpaper's animation loop.
Requires Python, numpy, scipy and scikit-image ONLY to rebuild this asset.
The shipped asset is read directly by the dependency-free browser application.
A sampled signed density surface produces actual cavities and irregular outlines;
vertex occlusion is baked from hemispherical visibility, not a screen-space pass.
"""
from pathlib import Path
import ast, re, struct
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from skimage.measure import marching_cubes

ROOT=Path(__file__).resolve().parents[1]
layout=(ROOT/'scenes/reefscape/src/layout.js').read_text()
rocks=ast.literal_eval(re.search(r'export const ROCKS=(\[.*?\]);',layout,re.S).group(1).replace(',\n]', '\n]'))
rng=np.random.default_rng(82641)
pos=[]; norms=[]; colors=[]; faces=[]; offset=0
for ri,r in enumerate(rocks):
    center=np.array(r[:3]); scale=np.array(r[3:]); n=54 if max(scale)>1.4 else 38
    span=1.4; step=span*2/(n-1)
    grid=np.linspace(-span,span,n,dtype=np.float32)
    x,y,z=np.meshgrid(grid,grid,grid,indexing='ij')
    # Asymmetry at three scales: limestone lobes, erosion, then resolved pores.
    noise=np.zeros((n,n,n),np.float32)
    for sig,amp in [(7,.28),(2.5,.13),(.85,.065)]:
        ns=gaussian_filter(rng.standard_normal((n,n,n)).astype(np.float32),sig,mode='reflect')
        ns/=max(ns.std(),1e-6);noise+=amp*ns
    f=1-(x*x+y*y+z*z)+noise
    # Real recesses, not black dots pasted onto an unbroken smooth boulder.
    for k in range(35):
        d=rng.normal(size=3);d/=np.linalg.norm(d)
        rr=rng.uniform(.065,.165);c=d*rng.uniform(.77,1.08)
        rs=np.array([rr,rr*rng.uniform(.75,1.3),rr*rng.uniform(.8,1.4)])
        cavity=((x-c[0])/rs[0])**2+((y-c[1])/rs[1])**2+((z-c[2])/rs[2])**2-1
        f=np.minimum(f,cavity*.4)
    # A few deeper openings through the thinner rock shoulders.
    if ri in (2,8):
        cx,cy=rng.uniform(-.22,.22,2)
        tunnel=((x-cx)/.19)**2+((y-cy)/.16)**2-1+.25*np.sin(z*5)
        f=np.minimum(f,tunnel*.5)
    v,fc,nm,_=marching_cubes(f,0,spacing=(step,)*3,allow_degenerate=False)
    v=v-span
    # skimage's density gradient normals point out of the positive rock volume.
    nm=nm/scale;nm/=np.linalg.norm(nm,axis=1,keepdims=True)
    wp=v*scale+center
    # Visibility of a handful of sky directions baked into vertex albedo/AO.
    ao=np.ones(len(v),np.float32)
    samples=[np.array([0,1,0]),np.array([.65,.7,.3]),np.array([-.7,.6,.3]),np.array([.1,.55,-.8])]
    for d in samples:
        d=d/np.linalg.norm(d)
        for dist in (.09,.23,.46):
            points=(v+(nm*.035+d*dist)/scale+span)/step
            val=map_coordinates(f,points.T,order=1,mode='constant',cval=-1)
            ao-=np.maximum(0,np.minimum(1,val*6))*.056
    # Cream limestone crusted with mauve coralline and filmed with olive algae.
    # Two patch scales, so the crust breaks up instead of painting smooth blotches.
    patch=np.sin(wp[:,0]*5.8+np.sin(wp[:,2]*7.7))*np.sin(wp[:,1]*6.9+wp[:,2]*2)
    crust=np.sin(wp[:,0]*13.5+2.1*np.sin(wp[:,1]*9.))*np.sin(wp[:,2]*12.2+1.7*np.sin(wp[:,0]*8.5))
    fine=np.sin(wp[:,0]*21+wp[:,2]*16)*np.sin(wp[:,1]*25+wp[:,2]*13)
    speck=np.sin(wp[:,0]*17.3+wp[:,1]*14.1)*np.sin(wp[:,2]*15.7-wp[:,1]*12.9)
    up=np.clip(nm[:,1],0,1)
    # Mature live rock is coralline first and bare limestone second: under a blue-white
    # reef lamp the crust is what gives it its violet cast, so it covers most of the
    # surface here and the limestone shows through only where the crust breaks. Real
    # coralline runs from deep violet to rose within one rock, so the crust carries its
    # own slow hue drift: neighbouring patches differ, which is where the colour in a
    # photograph of live rock actually comes from.
    hue=np.sin(wp[:,0]*3.1+wp[:,2]*2.3)*np.sin(wp[:,1]*2.7-wp[:,0]*1.9)
    cream=np.array([.425,.378,.298]); violet=np.array([.255,.098,.290]); rose=np.array([.340,.135,.180])
    olive=np.array([.150,.185,.070])
    crustco=violet*(1-np.clip(hue*.9+.45,0,1))[:,None]+rose*np.clip(hue*.9+.45,0,1)[:,None]
    # Coralline prefers the shaded flanks, algae film the lit upper faces. The crust ends
    # in a hard margin, not a gradient, so patches read as patches.
    blend=np.clip((patch*.85+crust*.70+.18)*(1-.40*up)*1.05-.06,0,.80)[:,None]
    co=cream*(1-blend)+crustco*blend
    algae=np.clip((-patch*.80-crust*.50+.06)*1.25*(.40+1.10*up),0,.58)[:,None]
    co=co*(1-algae)+olive*algae
    co*=((.90+fine*.10+speck*.075)*ao*(.62+.38*np.clip((nm[:,1]+.55),0,1)))[:,None]
    pos.append(wp.astype('<f4'));norms.append(nm.astype('<f4'));colors.append(np.clip(co*255,0,255).astype('u1'))
    faces.append((fc[:, ::-1]+offset).astype('<u4'));offset+=len(v)
    print(f'rock {ri+1}: {len(v):,} vertices / {len(fc):,} triangles',flush=True)
p=np.concatenate(pos);normal=np.concatenate(norms);col=np.concatenate(colors);idx=np.concatenate(faces).ravel()
target=ROOT/'scenes/reefscape/assets/live-rock.bin'
# header 4 uint32: magic, format version, vertices, indices; 3f position, 3f normal,
# 3u8 linear color per vertex; align the index stream to 4 bytes.
blob=bytearray(struct.pack('<IIII',0x52454546,1,len(p),len(idx)))
blob.extend(p.tobytes());blob.extend(normal.tobytes());blob.extend(col.tobytes())
while len(blob)%4:blob.append(0)
blob.extend(idx.tobytes());target.write_bytes(blob)
# A small top-surface field seats polyps on the actual baked rock, rather than
# the coarser ellipsoid collision envelopes used by swimming fish.
# Rasterize the mesh's top surface with barycentric interpolation. Unlike a max
# filter over nearby vertices, this does not lift polyps off steep rock faces.
W,H=385,193
field=np.full((H,W),-99,dtype=np.float32)
tri=p[np.concatenate(faces)]
gx=(tri[:,:,0]+9.65)/19.3*(W-1);gz=(tri[:,:,2]+4.1)/10.2*(H-1)
ytri=tri[:,:,1]
x0=np.floor(gx.min(axis=1)).astype(int);z0=np.floor(gz.min(axis=1)).astype(int)
dx=np.ceil(gx.max(axis=1)).astype(int)-x0;dz=np.ceil(gz.max(axis=1)).astype(int)-z0
den=(gz[:,1]-gz[:,2])*(gx[:,0]-gx[:,2])+(gx[:,2]-gx[:,1])*(gz[:,0]-gz[:,2])
valid_den=np.abs(den)>1e-9;den=np.where(valid_den,den,1.)
for j in range(int(dz.max())+1):
    for i in range(int(dx.max())+1):
        xx=x0+i;zz=z0+j
        aa=((gz[:,1]-gz[:,2])*(xx-gx[:,2])+(gx[:,2]-gx[:,1])*(zz-gz[:,2]))/den
        bb=((gz[:,2]-gz[:,0])*(xx-gx[:,2])+(gx[:,0]-gx[:,2])*(zz-gz[:,2]))/den
        cc=1-aa-bb
        mask=valid_den&(i<=dx)&(j<=dz)&(aa>=-1e-5)&(bb>=-1e-5)&(cc>=-1e-5)&(xx>=0)&(xx<W)&(zz>=0)&(zz<H)
        yy=aa*ytri[:,0]+bb*ytri[:,1]+cc*ytri[:,2]
        np.maximum.at(field,(zz[mask],xx[mask]),yy[mask])
xx,zz=np.meshgrid(np.linspace(-9.65,9.65,W),np.linspace(-4.1,6.1,H))
bed=-.30+.12*np.sin(xx*.49+zz*.22)+.075*np.sin(zz*.75-xx*.25)+.25*np.exp(-((xx-6)**2/17+(zz+1)**2/13))
field=np.maximum(field,bed)
(ROOT/'scenes/reefscape/assets/rock-support.bin').write_bytes(struct.pack('<II',W,H)+field.astype('<f4').tobytes())
print(f'{target.name}: {len(blob):,} bytes; {len(idx)//3:,} triangles')
