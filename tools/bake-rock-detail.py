"""Generate a small seamless limestone pore/height atlas and matching normal map.
No image-generation references are sampled into the running environment.
"""
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'scenes/reefscape/assets'
rng=np.random.default_rng(912824);n=512
noise=np.zeros((n,n),np.float32)
for sigma,amp in [(42,.16),(14,.12),(4,.075),(.8,.04)]:
 q=gaussian_filter(rng.normal(size=(n,n)),sigma,mode='wrap');q/=q.std();noise+=q*amp
height=.52+noise*.24
y,x=np.mgrid[:n,:n]
# Two populations. The large pits are what a viewer actually resolves on a tank rock at
# arm's length — the atlas is laid over roughly 1.6 units of rock, so a 30 px pit here is
# about a 2 cm cavity there. The small ones only carry the close-up grain.
for count,lo,hi,dlo,dhi in [(240,14.,48.,.10,.30),(1500,1.6,8.5,.04,.15)]:
 for k in range(count):
  cx,cy=rng.uniform(0,n,2);r=rng.uniform(lo,hi);sx=r*rng.uniform(.8,1.4);sy=r*rng.uniform(.65,1.3)
  # Torus distance wraps pores cleanly over texture edges.
  dx=np.minimum(np.abs(x-cx),n-np.abs(x-cx))/sx;dy=np.minimum(np.abs(y-cy),n-np.abs(y-cy))/sy
  d=dx*dx+dy*dy
  depth=rng.uniform(dlo,dhi)
  height-=depth*np.exp(-d*1.7)
  height+=depth*.26*np.exp(-((np.sqrt(d)-1.1)/.22)**2)
height=np.clip(height,.03,.98)
gx=(np.roll(height,-1,1)-np.roll(height,1,1))*7.0;gy=(np.roll(height,-1,0)-np.roll(height,1,0))*7.0
normal=np.stack([-gx,gy,np.ones_like(height)],-1);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
Image.fromarray(np.uint8((normal*.5+.5)*255)).save(ROOT/'limestone-normal.png')
Image.fromarray(np.uint8(np.clip(height*1.45-.12,0,1)*255)).save(ROOT/'limestone-detail.png')
print('512px wrapped limestone height / normal maps written.')
