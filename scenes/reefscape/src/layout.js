// Aquarium coordinates: one unit = 10 cm. This single layout is shared by the
// hardscape asset baker, simulation collision envelopes and attachment placement.
export const TANK={left:-9.65,right:9.65,back:-4.1,front:6.1,surface:8.5};
// The last three rocks are a central arch joining the islands at the back: two pillars and a stepped lintel over a cave.
export const ROCKS=[
  [-5.65,.65,-.80,2.55,1.18,1.75],
  [-6.85,1.80,-1.35,1.63,1.56,1.48],
  [-5.30,2.80,-1.12,1.66,1.30,1.39],
  [-3.96,1.77,.62,1.88,1.23,1.42],
  [-3.24,.52,1.53,1.63,.78,1.08],
  [-7.70,.15,1.62,1.36,.63,1.04],
  [-5.77,.30,2.23,1.54,.71,.93],
  [5.32,.59,-1.06,2.61,1.19,1.69],
  [6.56,1.98,-1.38,1.60,1.60,1.43],
  [4.68,1.90,-.64,1.54,1.19,1.33],
  [3.06,.65,.65,1.29,.85,1.16],
  [5.57,.24,1.90,1.79,.63,1.12],
  [7.62,.10,2.34,1.02,.48,.89],
  [2.19,.05,2.12,.98,.43,.77],
  [-1.55,1.0,-1.05,.95,1.55,1.10],
  [1.80,.90,-1.15,.95,1.45,1.05],
  [-.55,2.62,-1.20,1.65,.78,1.00],
  [1.25,2.98,-1.28,1.50,.72,.92],
];
// The clownfish host, on the left island's front shoulder. x, y, z is its oral disc — the
// column runs from there down to the rock — and radius the crown's reach; the clownfish
// goals, their shelter point and the non-host avoidance all key off these. lean tips the
// axis (x and z, as a share of its height) so the disc faces the viewer a little.
export const HOST={x:-3.95,y:3.72,z:1.0,radius:1.25,lean:[.10,.30]};
// The host comes first. Small specimens use an explicit compact crown, not a shrunken
// host. They sit low on free rock, with independent leans. y is the authored disc height;
// the compact form settles its disc a little lower to sit into the rock shoulder.
export const ANEMONES=[HOST,
  {x:5.50,y:1.24,z:2.00,radius:.70,form:'compact',lean:[.15,.80]},
  {x:4.80,y:1.10,z:2.50,radius:.42,form:'compact',lean:[-.30,.50]},
  {x:-2.35,y:1.02,z:2.25,radius:.40,form:'compact',lean:[.20,.50]},
  {x:-2.45,y:1.30,z:1.75,radius:.26,form:'compact',lean:[0,.60]}];
// Both stations are flat rock shoulders the cleaner shrimp advertise from. Their y is the
// rock top there — the shrimp seat themselves off the baked surface, but a station buried
// inside the rock would still send grazing fish to the wrong height.
export const STATIONS=[{x:2.23,y:.57,z:2.22},{x:-5.15,y:.98,z:2.72}];
// Coral envelopes fish steer around. The last three are the gorgonian fan, which
// stands well up into the swimming volume, and the arch lintel colonies.
export const CORAL_BOUNDS=[[-6.0,4.35,-1.05,1.4,1.4,1.3],[6.0,4.2,-1.4,1.5,1.3,1.3],[4.4,3.1,-.2,1.65,.45,1.5],
  [6.98,4.95,-.70,1.35,1.75,.60],[-.45,3.95,-1.14,.80,.70,.70],[1.34,4.20,-1.24,.70,.65,.65]];
// Named refuges for an alarm, not constraints on ordinary reef-wide roaming. The arch
// lintel is the anthias' refuge; the two Acropora crowns shelter the chromis pods.
export const THICKETS=CORAL_BOUNDS.slice(0,2).map(([x,y,z,,ry])=>({x,y,z,top:y+ry}));
export const PROMONTORY={x:.38,y:3.70,z:-1.22};
