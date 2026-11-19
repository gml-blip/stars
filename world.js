'use strict';
const World = (() => {
  const T = THREE, tau = Math.PI * 2;
  const coarse = matchMedia('(pointer:coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(53, innerWidth / innerHeight, .1, 1300);
  const renderer = new T.WebGLRenderer({antialias: !coarse, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.25 : 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = T.SRGBColorSpace;
  document.querySelector('#stage').append(renderer.domElement);

  let seed=217;
  function random() {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    return seed / 4294967296;
  }

  // The broad center carries the knife grain; piled pigment forms uneven rims.
  function relief(u,v){
    const taper=Math.sin(u*Math.PI)**.55;
    const grain=.017*Math.sin(v*208+u*4)+.012*Math.sin(v*427-u*3);
    const fold=Math.exp(-((v-.49-.045*Math.sin(u*7))**2)*920);
    const lip=Math.exp(-((v-.87-.036*Math.sin(u*14))**2)*230);
    const edge=Math.exp(-((v-.12-.04*Math.sin(u*19))**2)*270);
    return Math.max(0,taper*(.18+.26*lip+.17*fold+.12*edge+grain));
  }
  const reliefCanvas=document.createElement('canvas');
  reliefCanvas.width=128;reliefCanvas.height=128;
  const reliefCtx=reliefCanvas.getContext('2d');
  const reliefData=reliefCtx.createImageData(128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const i=(y*128+x)*4, level=Math.round(relief(x/127,y/127)*500);
    reliefData.data.set([level,level,level,255],i);
  }
  reliefCtx.putImageData(reliefData,0,0);
  const knifeRelief=new T.CanvasTexture(reliefCanvas);
  knifeRelief.wrapS=knifeRelief.wrapT=T.RepeatWrapping;

  const unitBlock=new T.BoxGeometry(1,1,1);
  const palette={
    starlight:['#a86e36','#ca9948','#e6b75c','#f4ce73','#ffe29a','#fff1ba'],
    earth:['#142b44','#204657','#285962','#326b69','#458078','#599184','#72a68e'],
    sail:['#571d3b','#8a2842','#b23447','#d44744','#e85b48','#f57654'],
    trail:['#597a7d','#729d97','#9cbbae','#c5c49e','#e5cb92']
  };
  const pigments=new Map();
  function pigment(value){
    if(!pigments.has(value))pigments.set(value,new T.Color(value));
    return pigments.get(value);
  }
  function block(w,h,d,mat,x,y,z,parent){
    const piece=mesh(unitBlock,mat,x,y,z,parent);
    piece.scale.set(w,h,d);
    return piece;
  }
  function faceMesh(positions,indices,colorFor,brushUV){
    const vertices=[],colors=[],uvs=[];
    for(let i=0;i<indices.length;i+=3){
      const corners=indices.slice(i,i+3);
      const color=pigment(colorFor(i/3,corners));
      for(const index of corners){
        const at=index*3;
        vertices.push(positions[at],positions[at+1],positions[at+2]);
        colors.push(color.r,color.g,color.b);
        if(brushUV)uvs.push(...brushUV(positions[at],positions[at+1],positions[at+2],index));
      }
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    if(brushUV)geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    geometry.computeVertexNormals();
    return geometry;
  }
  function fillPolygon(ctx,points,color){
    ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for(const point of points.slice(1))ctx.lineTo(...point);
    ctx.closePath();ctx.fill();
  }

  const stamps=new Map();
  function knifeStamp(color){
    if(stamps.has(color))return stamps.get(color);
    const c=document.createElement('canvas');
    c.width=128;c.height=48;
    const ctx=c.getContext('2d'), data=ctx.createImageData(c.width,c.height);
    const rgb=pigment(color).clone().convertLinearToSRGB();
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const u=x/(c.width-1),v=y/(c.height-1),i=(y*c.width+x)*4;
      const start=.034+.044*Math.sin(v*12)+.026*Math.sin(v*42);
      const end=.96+.024*Math.sin(v*20)-.027*Math.cos(v*49);
      const top=.07+.048*Math.sin(u*17)+.029*Math.cos(u*51);
      const bottom=.94+.031*Math.sin(u*32)-.032*Math.cos(u*61);
      if(u<start||u>end||v<top||v>bottom)continue;
      const edge=Math.min((u-start)*2,(end-u)*2,v-top,bottom-v);
      const lift=relief(u,v)-relief(Math.max(0,u-.018),Math.max(0,v-.029));
      const light=.97+Math.max(-.19,Math.min(.22,lift*1.9))+.17*Math.exp(-edge*65);
      data.data[i]=rgb.r*255*light+Math.max(0,lift)*56;
      data.data[i+1]=rgb.g*255*light+Math.max(0,lift)*62;
      data.data[i+2]=rgb.b*255*light+Math.max(0,lift)*54;
      data.data[i+3]=255;
    }
    ctx.putImageData(data,0,0);stamps.set(color,c);return c;
  }
  function layStroke(ctx,a,b,width,color){
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    ctx.save();ctx.translate(a[0],a[1]);ctx.rotate(Math.atan2(dy,dx));
    ctx.drawImage(knifeStamp(color),-length*.08,-width*.51,length*1.16,width);
    ctx.restore();
  }

  function knifeGeometry(){
    const columns=16,rows=12, positions=[],uvs=[],indices=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
      const u=i/columns,v=j/rows;
      const tip=(1-u)*(.035*Math.sin(v*19)+.04*Math.cos(v*34))+u*.055*Math.sin(v*31);
      const width=.89+.10*Math.sin(u*Math.PI)+.038*Math.sin(u*27);
      positions.push(u-.5+tip,relief(u,v)-.07,(v-.5)*width+.032*Math.sin(u*13));
      uvs.push(u,v);
      if(i&&j){
        const n=j*(columns+1)+i;
        indices.push(n,n-columns-1,n-1,n-1,n-columns-1,n-columns-2);
      }
    }
    // The thin skirt makes the raised edge visible from the shore and deck.
    const border=[];
    for(let i=0;i<=columns;i++)border.push(i);
    for(let j=1;j<=rows;j++)border.push(j*(columns+1)+columns);
    for(let i=columns-1;i>=0;i--)border.push(rows*(columns+1)+i);
    for(let j=rows-1;j>0;j--)border.push(j*(columns+1));
    const base=positions.length/3;
    for(let i=0;i<border.length;i++){
      const at=border[i]*3;
      positions.push(positions[at],-.13,positions[at+2]);
      uvs.push(uvs[border[i]*2],uvs[border[i]*2+1]);
      const next=(i+1)%border.length;
      indices.push(border[i],border[next],base+i,border[next],base+next,base+i);
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    return geometry;
  }
  const pigmentStroke=knifeGeometry();
  const brushAtlas={value:PatchOilPaint.createBrushSheet()};
  const sampleBrush=`
    uniform sampler2D brushAtlas;
    vec3 loadedBrush(vec2 acrossAlong,float cell){
      return texture2D(brushAtlas,(vec2(mod(cell,4.),floor(cell/4.))+acrossAlong)/vec2(4.,2.)).rgb;
    }`;

  function spiralPoint(eddy,lane,t,output){
    const [x,y,scale,turn]=eddy;
    const angle=t*tau*(1.09+lane*.011)*turn+.36+lane*.031;
    const radius=scale*(24+t*217+lane*4.1+8*Math.sin(t*Math.PI));
    output.set(x+Math.cos(angle)*radius+t*t*37,y+Math.sin(angle)*radius*.69+t*t*19);
  }
  function cloudBeltPoint(course,band,t,output,direction){
    const f=T.MathUtils.clamp(t,0,1);
    course.getPoint(f,output);course.getTangent(f,direction);
    const spread=band*(.44+.75*Math.sin(Math.PI*f))+Math.sin(f*31+band*.18)*1.9;
    output.x-=direction.y*spread;
    output.y+=direction.x*spread;
  }
  function flowingSkyPaint(swirls,course,colors,parent){
    const strokes=[];
    const divisions=8;
    const count=coarse?9:15;
    for(const eddy of swirls){
      for(const lane of [-4,-1,2,5]){
        for(let i=0;i<count;i++){
          strokes.push({eddy,lane,offset:(i+random()*.7)/count,length:.018+random()*.018,
            width:2.7+random()*4.5,speed:.012+random()*.005,color:pigment(colors[Math.floor(random()*colors.length)])});
        }
      }
    }
    for(const lane of [-20,-11,0,11,22]){
      for(let i=0;i<count;i++){
        strokes.push({lane,offset:(i+random()*.75)/count,length:.016+random()*.021,
          width:3.3+random()*4,speed:.022+random()*.006,color:pigment(colors[Math.floor(random()*colors.length)])});
      }
    }
    const positions=new Float32Array(strokes.length*(divisions+1)*6);
    const alpha=new Float32Array(positions.length/3);
    const uvs=[],rgb=[],indices=[];
    for(const [index,stroke] of strokes.entries()){
      for(let k=0;k<=divisions;k++){
        uvs.push(k/divisions,0,k/divisions,1);
        for(let side=0;side<2;side++)rgb.push(stroke.color.r,stroke.color.g,stroke.color.b);
        const at=index*(divisions+1)*2+k*2;
        if(k)indices.push(at-2,at-1,at,at,at-1,at+1);
      }
    }
    const geometry=new T.BufferGeometry();
    const shape=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage);
    const opacity=new T.BufferAttribute(alpha,1).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('position',shape);geometry.setAttribute('opacity',opacity);
    geometry.setAttribute('pigment',new T.Float32BufferAttribute(rgb,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
    const brush=new T.ShaderMaterial({
      uniforms:{brushAtlas},transparent:true,depthWrite:false,side:T.DoubleSide,
      vertexShader:`
        attribute vec3 pigment;
        attribute float opacity;
        varying vec3 ink;
        varying float fade;
        varying vec2 brushUV;
        void main(){ink=pigment;fade=opacity;brushUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
      `,
      fragmentShader:`
        ${sampleBrush}
        varying vec3 ink;
        varying float fade;
        varying vec2 brushUV;
        void main(){
          vec3 paint=loadedBrush(brushUV.yx,3.);
          gl_FragColor=vec4(ink*(.85+.28*paint.r+.12*paint.b),paint.g*fade);
          #include <colorspace_fragment>
        }
      `
    });
    const ribbons=new T.Mesh(geometry,brush);
    ribbons.frustumCulled=false;ribbons.renderOrder=-8;parent.add(ribbons);
    const point=new T.Vector2(),ahead=new T.Vector2(),direction=new T.Vector3();
    let lastTime=-1;
    return time=>{
      if(lastTime===time)return;
      lastTime=time;
      for(const [i,stroke] of strokes.entries()){
        const t=(stroke.offset+time*stroke.speed)%1;
        const fade=T.MathUtils.smoothstep(t,0,.12)*(1-T.MathUtils.smoothstep(t,.79,1))*.79;
        for(let j=0;j<=divisions;j++){
          const progress=t+(j/divisions-.5)*stroke.length;
          if(stroke.eddy){
            spiralPoint(stroke.eddy,stroke.lane,progress,point);
            spiralPoint(stroke.eddy,stroke.lane,progress+.002,ahead);
          }else{
            cloudBeltPoint(course,stroke.lane,progress,point,direction);
            cloudBeltPoint(course,stroke.lane,progress+.002,ahead,direction);
          }
          const dx=ahead.x-point.x,dy=ahead.y-point.y;
          const width=stroke.width*(.40+.78*t)*(.32+.68*Math.sin(Math.PI*j/divisions))/Math.max(.001,Math.hypot(dx,dy));
          for(let side=0;side<2;side++){
            const edge=side-.5;
            const phi=(point.x-dy*width*edge)*tau/3072;
            const theta=(point.y+dx*width*edge)*Math.PI/1536;
            const at=(i*(divisions+1)+j)*2+side;
            const r=850*Math.sin(theta);
            shape.setXYZ(at,-r*Math.cos(phi),850*Math.cos(theta),r*Math.sin(phi));
            alpha[at]=fade;
          }
        }
      }
      shape.needsUpdate=true;opacity.needsUpdate=true;
    };
  }

  function mosaicSky() {
    const previousSeed=seed;
    const width=coarse?3072:4096,height=width/2,scale=width/3072;
    function layer(){
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');context.scale(scale,scale);
      return {canvas,context};
    }
    const base=layer(),light=layer(),ctx=base.context,glaze=light.context;
    const deep=['#040b24','#081438','#122354','#153675','#275aa0','#3575b0','#5a93bf','#7bb3cb'];
    const current=['#164387','#316bb0','#5797ce','#80bad9','#a2d3d4','#c8dfc5','#e3dfad'];
    const halo=['#254f92','#427ab0','#639ebd','#9fc8b5','#d8db9b','#ffce59','#ffe283','#fff3ba'];
    ctx.fillStyle=deep[0];ctx.fillRect(0,0,3072,1536);
    const haze=ctx.createLinearGradient(0,350,0,790);
    for(const [stop,color] of [[0,deep[0]],[.35,deep[2]],[.70,deep[3]],[.93,'#4086ae'],[1,'#77aeb8']])haze.addColorStop(stop,color);
    ctx.fillStyle=haze;ctx.fillRect(0,180,3072,700);

    const swirls=[[2128,663,.74,-1],[1969,660,.43,1],[2630,649,.45,-1],[1362,621,.64,1],[392,671,.75,-1]];
    const stars=[[2290,671,28],[1839,620,35],[2195,582,16],[2391,607,23],[2101,588,17],[1990,571,15],[2490,653,19],[471,595,32],[1090,585,27],[1658,646,31]];
    function stroke(ctx,x,y,angle,length,thickness,pigment){
      const dx=Math.cos(angle)*length*.5,dy=Math.sin(angle)*length*.5;
      layStroke(ctx,[x-dx,y-dy],[x+dx,y+dy],thickness,pigment);
    }
    // The underpainting already follows the wind, so the bright ribbons
    // emerge from the darker paint instead of floating over a static grid.
    for(let i=0;i<(coarse?4900:7200);i++){
      const x=random()*3072,y=305+random()*468;
      let angle=.14*Math.sin(x*.008+y*.019),nearest=Infinity;
      for(const [cx,cy,s,d] of swirls){
        const dx=x-cx,dy=(y-cy)*1.25,dist=Math.hypot(dx,dy)/s;
        if(dist<nearest&&dist<245){
          nearest=dist;angle=Math.atan2(dy,dx)+d*(1.25+.27*Math.min(1,dist/170));
        }
      }
      for(const [cx,cy,r] of stars){
        const dx=x-cx,dy=y-cy,dist=Math.hypot(dx,dy);
        if(dist<r*2.6){angle=Math.atan2(dy,dx)+Math.PI/2;break;}
      }
      const band=(y-450)/65+Math.sin(x*.013)*.62+random()*2.8;
      const pigment=deep[T.MathUtils.clamp(Math.floor(band)+1,0,deep.length-1)];
      ctx.globalAlpha=.45+random()*.47;
      stroke(ctx,x,y,angle,9+random()*36,2.4+random()*7.5,pigment);
    }
    ctx.globalAlpha=1;

    function spirals(target,lanes){
      const point=new T.Vector2(),ahead=new T.Vector2();
      for(const eddy of swirls){
        const size=eddy[2];
        for(const [band,paints,opacity] of lanes){
          // Paint a slim unbroken under-ribbon before laying on overlapping knife ridges.
          target.beginPath();
          for(let i=0;i<=128;i++){
            spiralPoint(eddy,band,i/128,point);
            if(i)target.lineTo(point.x,point.y);else target.moveTo(point.x,point.y);
          }
          target.strokeStyle=paints[0];target.lineWidth=size*4.0;target.lineCap='round';
          target.globalAlpha=opacity*.61;target.stroke();
          target.globalAlpha=opacity;
          let t=random()*.019;
          while(t<1){
            const next=t+.009+random()*.009;
            const pigment=paints[Math.floor(random()*paints.length)];
            spiralPoint(eddy,band,t,point);spiralPoint(eddy,band,next+.006,ahead);
            layStroke(target,[point.x,point.y],[ahead.x,ahead.y],size*(3+random()*4+t*5),pigment);
            t=next;
          }
        }
      }
      target.globalAlpha=1;
    }
    // Atlas X runs right-to-left from the opening camera.
    const cloudBelt=new T.CatmullRomCurve3([
      [2580,720],[2445,696],[2320,644],[2220,610],[2142,613],
      [2080,645],[2018,688],[1968,707],[1910,694],[1820,698],[1690,738]
    ].map(([x,y])=>new T.Vector3(x,y,0)));
    function paintCloudBelt(target,colors,bands,opacity){
      const a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();
      for(const band of bands){
        for(let t=.009+random()*.023;t<.996;){
          const next=Math.min(1,t+.009+random()*.008);
          const envelope=Math.sin(t*Math.PI)**.63;
          target.globalAlpha=opacity*envelope;
          const shift=Math.floor(random()*colors.length);
          cloudBeltPoint(cloudBelt,band,t,a,direction);
          cloudBeltPoint(cloudBelt,band,next,b,direction);
          layStroke(target,[a.x,a.y],[b.x,b.y],3.1+envelope*(3+random()*4.2),colors[shift]);
          t=next-.001;
        }
      }
      target.globalAlpha=1;
    }
    paintCloudBelt(ctx,current.slice(0,5),[-39,-32,-25,-18,-11,-4,3,10,17,24,31,38],.94);
    spirals(ctx,[-7,-5,-3,-1,1,3,5,7,9].map((band,i)=>[band,i%3?current.slice(0,5):deep.slice(2,7),.89]));
    // A second layer has thinner ridges, warmer light and a separate drift.
    spirals(glaze,[-4,-2,0,2,4,6].map((band,i)=>[band,i%3?current.slice(2,6):current.slice(3),.74]));
    paintCloudBelt(glaze,current.slice(2),[-24,-14,-5,6,16,26],.63);

    for(let i=0;i<460;i++){
      const x=random()*3072,y=739+27*Math.sin(x*.007)+random()*38;
      stroke(ctx,x,y,.12*Math.cos(x*.007),13+random()*37,2.4+random()*7,current[2+i%4]);
    }
    function star(x,y,r,moon){
      const bloom=glaze.createRadialGradient(x,y,r*.15,x,y,r*2.25);
      bloom.addColorStop(0,'#fff8daff');bloom.addColorStop(.32,'#ffe69cc4');
      bloom.addColorStop(.69,'#ffc55b54');bloom.addColorStop(1,'#63c7be00');
      glaze.fillStyle=bloom;glaze.fillRect(x-r*2.25,y-r*2.25,r*4.5,r*4.5);
      for(let j=8;j>=0;j--){
        const radius=r*(.13+j*.202),count=Math.max(6,Math.ceil(radius*.81));
        for(let i=0;i<count;i++){
          const a=i*tau/count+j*.29+(random()-.5)*.10;
          const spread=radius*(.92+random()*.16);
          const index=Math.max(0,Math.min(halo.length-1,8-j+Math.floor(random()*3)-2));
          stroke(glaze,x+Math.cos(a)*spread,y+Math.sin(a)*spread,a+Math.PI/2,
            (3+radius*tau/count)*(.82+random()*.39),Math.max(2.8,r*.16),halo[index]);
        }
      }
      if(moon){
        glaze.fillStyle='#d79e47';glaze.beginPath();glaze.arc(x,y,r*.43,0,tau);glaze.fill();
        glaze.fillStyle='#fff0a2';glaze.beginPath();glaze.arc(x,y,r*.48,-1.27,2.10);
        glaze.quadraticCurveTo(x+r*.26,y+r*.07,x+Math.cos(-1.27)*r*.48,y+Math.sin(-1.27)*r*.48);
        glaze.fill();
        for(let i=0;i<25;i++){
          const a=-1.16+i*.13;
          stroke(glaze,x+Math.cos(a)*r*.45,y+Math.sin(a)*r*.45,a+Math.PI/2,r*.14,r*.103,halo[5+i%3]);
        }
      }else{
        stroke(glaze,x,y,.24,r*.63,r*.49,halo[7]);
        stroke(glaze,x-r*.13,y+r*.085,.18,r*.30,r*.18,halo[5]);
      }
      const glow=glaze.createRadialGradient(x,y,0,x,y,r*1.54);
      glow.addColorStop(0,'#fff8dbef');glow.addColorStop(.35,'#ffce6765');glow.addColorStop(1,'#ffd97800');
      glaze.fillStyle=glow;glaze.fillRect(x-r*1.54,y-r*1.54,r*3.08,r*3.08);
    }
    stars.forEach(([x,y,r],index)=>star(x,y,r,index===1));
    for(let i=0;i<1060;i++){
      const x=random()*3072,y=170+random()*569,s=.55+random()**4*3.8;
      fillPolygon(ctx,[[x-s,y],[x,y-s*.72],[x+s,y],[x,y+s*.72]],halo[3+i%5]);
    }

    const group=new T.Group();
    const makeSphere=(canvas,radius,transparent,order)=>{
      const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
      const material=new T.MeshBasicMaterial({map,side:T.BackSide,depthWrite:false,fog:false,transparent,alphaTest:transparent?.007:0});
      const shell=new T.Mesh(new T.SphereGeometry(radius,64,40),material);
      shell.renderOrder=order;group.add(shell);return shell;
    };
    makeSphere(base.canvas,890,false,-10);
    makeSphere(light.canvas,861,true,-9);
    const animateSky=flowingSkyPaint([...swirls,...stars.map(([x,y,r])=>[x,y,r/138,-1])],cloudBelt,current.slice(2),group);
    seed=previousSeed;
    return {group,animateSky};
  }
  const {group:sky,animateSky}=mosaicSky();scene.add(sky);
  scene.fog=new T.FogExp2(0x294a5b,.0057);
  scene.add(new T.HemisphereLight(0xa0c6e2,0x363455,1.12));
  const moon=new T.DirectionalLight(0xffdcab,3.1); moon.position.set(45,75,-55);scene.add(moon);
  const fill=new T.DirectionalLight(0x80baf1,.77);fill.position.set(-25,11,45);scene.add(fill);

  const lampLight=new T.PointLight(0xffad55,19,11,2);
  const pigmentLights={
    moonDir:{value:new T.Vector3()},moonInk:{value:new T.Color()},
    lampPos:{value:new T.Vector3()},lampInk:{value:new T.Color()}
  };
  const pigmentLighting=`
    uniform vec3 moonDir,moonInk,lampPos,lampInk;
    vec3 litPigment(vec3 base,vec3 n,vec3 world){
      vec3 toLamp=lampPos-world;
      float d=max(.01,dot(toLamp,toLamp));
      float facing=max(0.,dot(n,toLamp*inversesqrt(d)));
      float warm=(.09+.91*facing)*(1.-smoothstep(36.,121.,d))/(1.+d);
      float key=smoothstep(-.16,.87,dot(n,moonDir));
      vec3 body=base*vec3(.44,.59,.88);
      body+=key*moonInk*(base*1.22+vec3(.024,.028,.033));
      return body+warm*lampInk*(base*.96+vec3(.039,.022,.013));
    }`;
  const vortex = {x:39,z:-91};
  const tide = {value:0};
  const wakeLife=2.7,wakeLimit=coarse?7:11;
  const sternSamples=Array.from({length:wakeLimit},()=>new T.Vector4());
  const sternAges=new Float32Array(wakeLimit).fill(wakeLife);
  let nextStern=0;
  function markWake(x,z,dx,dz){
    sternSamples[nextStern].set(x,z,dx,dz);
    sternAges[nextStern]=0;
    nextStern=(nextStern+1)%wakeLimit;
  }
  function advanceWake(dt,reduced){
    for(let i=0;i<wakeLimit;i++){
      sternAges[i]=reduced?wakeLife:Math.min(sternAges[i]+dt,wakeLife);
    }
  }
  const waveHit = {value:new T.Vector4(0,0,1,0)};
  const hullCenter=new T.Vector2(),lampWater=new T.Vector2();
  const oceanMaterial=new T.ShaderMaterial({
    defines:{WAKE_LIMIT:wakeLimit},extensions:{derivatives:true},
    uniforms:{brushAtlas,time:tide,waveHit,hullCenter:{value:hullCenter},lampWater:{value:lampWater},sternSamples:{value:sternSamples},sternAges:{value:sternAges},
      vortex:{value:new T.Vector2(vortex.x,vortex.z)}},
    vertexShader:`
      uniform float time; varying vec3 p; attribute float paintTone; varying float tone;
      attribute vec2 brushUV; varying vec2 stroke;
      uniform vec2 hullCenter,lampWater;
      uniform vec4 sternSamples[WAKE_LIMIT];
      uniform float sternAges[WAKE_LIMIT];
      void main(){
        vec3 pos=position; tone=paintTone; stroke=brushUV;
        // The edges follow a common current. The raised spine flexes independently.
        float grain=fract(tone), ridge=pos.y;
        float phase=grain*18.+pos.x*.14+pos.z*.09-time*(.42+.29*grain);
        pos.x+=.29*sin(pos.z*.21+time*.28)+ridge*sin(phase)*1.9;
        pos.z+=.16*cos(pos.x*.22-time*.25)+ridge*cos(phase)*.51;
        float lift=0.;
        if(ridge>0. && distance(pos.xz,cameraPosition.xz)<40.){
          for(int i=0;i<WAKE_LIMIT;i++){
            float age=sternAges[i];
            if(age>=2.7)continue;
            vec2 delta=pos.xz-sternSamples[i].xy;
            float edge=length(delta)-(.48+age*2.25);
            lift+=exp(-edge*edge*2.)*smoothstep(0.,.18,age)*(1.-smoothstep(.6,2.7,age));
          }
        }
        vec2 ahead=lampWater-hullCenter;
        vec2 across=vec2(-ahead.y,ahead.x)/max(length(ahead),.001);
        vec2 bow=pos.xz-lampWater;
        float side=dot(bow,across);
        float curl=exp(-dot(bow,bow)*.38)*smoothstep(.12,.91,abs(side));
        pos.xz+=across*side*curl*.27;
        pos.y+=ridge*(.48*sin(phase)+min(lift,1.5)+curl*.75);
        pos.y += .19*sin(pos.x*.27+pos.z*.19-time*.68)+.09*cos(pos.z*.53+pos.x*.08+time*.52);
        p=(modelMatrix*vec4(pos,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader:`
      uniform float time;
      ${sampleBrush}
      uniform vec2 vortex,hullCenter,lampWater;
      uniform vec4 sternSamples[WAKE_LIMIT];
      uniform float sternAges[WAKE_LIMIT];
      uniform vec4 waveHit;

      varying vec3 p; varying float tone; varying vec2 stroke;
      float hash(vec2 cell){return fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);}
      vec3 seaPigment(float i){
        if(i<1.)return vec3(.024,.064,.164);
        if(i<2.)return vec3(.043,.120,.262);
        if(i<3.)return vec3(.059,.197,.378);
        if(i<4.)return vec3(.118,.350,.512);
        if(i<5.)return vec3(.175,.451,.587);
        if(i<6.)return vec3(.245,.571,.649);
        return vec3(.366,.680,.702);
      }
      vec2 sternWaves(vec2 x){
        vec2 swell=vec2(0.);
        for(int i=0;i<WAKE_LIMIT;i++){
          float age=sternAges[i];
          if(age>=2.7)continue;
          vec4 mark=sternSamples[i];
          vec2 delta=x-mark.xy;
          if(dot(delta,delta)>91.)continue;
          float behind=-dot(delta,mark.zw);
          float across=dot(delta,vec2(-mark.w,mark.z));
          float drift=behind-age*.55;
          float arc=length(vec2(across*.79,drift*1.23));
          float radius=.48+age*2.25+.14*sin(across*.91+age*1.9);
          float width=.31+age*.23;
          float edge=(arc-radius)/width;
          float hollow=edge+1.28;
          float fade=smoothstep(0.,.14,age)*(1.-smoothstep(.65,2.7,age));
          float sweep=smoothstep(-.24-age*.29,.31,drift);
          vec2 wave=exp(-vec2(edge*edge,hollow*hollow)*1.55);
          swell+=wave*fade*sweep;
        }
        return swell;
      }
      void main(){
        vec2 x=p.xz;
        float range=distance(cameraPosition,p);
        if(range>170.){gl_FragColor=vec4(.106,.228,.315,1.);return;}
        vec2 v=x-vortex;
        float r=length(v);
        float a=atan(v.y,v.x+.001);
        vec2 swell=sternWaves(x);
        vec2 away=x-waveHit.xy;
        float crest=(length(away)-waveHit.z*6.)*2.4;
        float push=waveHit.w*exp(-crest*crest)*max(0.,1.-waveHit.z);
        float grain=fract(tone);
        float surface=.51+.26*sin(x.x*.27+x.y*.19-time*.68)
                          +.17*cos(x.y*.53+x.x*.08+time*.52);
        vec3 color=seaPigment(floor(tone))*(.93+.14*grain);
        // Short dragged touches subdivide each world-anchored wave crest.
        vec2 track=vec2(stroke.x*4.7+grain*16.,stroke.y*6.+.39*sin(stroke.x*4.+grain*9.));
        track.x+=.43*floor(track.y);
        float dye=hash(floor(track)+floor(tone)*17.);
        vec3 bristles=loadedBrush(fract(track).yx,floor(dye*7.99));
        float mark=bristles.g*(.65+.28*bristles.r+.20*bristles.b);
        color=mix(color,seaPigment(clamp(floor(tone)+(dye>.61?1.:-1.),0.,6.)),mark*.48*(1.-smoothstep(20.,85.,range)));
        float groove=stroke.y*19.+sin(stroke.x*3.4+grain*9.)*.9;
        float clarity=(1.-smoothstep(.25,1.6,fwidth(groove)))*(1.-smoothstep(15.,55.,range));
        color*=1.+clarity*(.09*sin(groove)+.04*cos(groove*2.1+grain));
        vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
        color*=.81+.35*max(0.,dot(normal,normalize(vec3(-.55,.82,.32))));
        float starPath=exp(-pow((x.x+.31*x.y-11.)*.135,2.));
        float glint=starPath*smoothstep(.64,.93,surface)*(.42+.58*grain);
        color+=vec3(.10,.17,.21)*smoothstep(.66,.94,surface)*smoothstep(.26,.68,normal.z+.42);
        color=mix(color,vec3(1.,.84,.49),glint*.88);
        float spiral=.5+.5*sin(a*3.+r*.88-time*.81);
        float warmth=(1.-smoothstep(10.,26.,r))*smoothstep(.48,.92,spiral);
        color=mix(color,mix(vec3(.30,.60,.57),vec3(.85,.75,.44),surface),warmth*.82);
        color+=push*vec3(.13,.26,.27)*(.35+grain*.65);
        color=mix(color,vec3(.31,.73,.80),min(.57,swell.x*(.43+grain*.13)));
        float foam=smoothstep(.20,.86,swell.x)*(.40+grain*.42);
        color=mix(color,vec3(.76,.94,.91),foam*.72);
        color*=1.-min(.20,swell.y*.13);
        vec2 shadow=x-hullCenter;
        color*=1.-.31*exp(-dot(shadow,shadow)*.57);
        vec2 lantern=x-lampWater;
        color=mix(color,vec3(.92,.62,.29),.35*exp(-dot(lantern,lantern)*.68)*(.48+.52*grain));
        color=mix(color,vec3(.106,.228,.315),smoothstep(62.,170.,range));
        gl_FragColor=vec4(color,1.);
      }`
  });
  // Staggered six-sided paint pieces share their entire perimeter. Each crown
  // adds real relief while the warped lattice turns across the bay.
  const vertices=[],tones=[],faces=[],brushCoords=[];
  const rows=coarse?264:354,columns=coarse?72:90;
  function seaPoint(u,v){
    const far=n=>n+Math.sign(n)*480*Math.pow(Math.min(1,Math.abs(n)/220),9);
    const x=far(u+.36*Math.sin(v*.53+u*.31));
    const z=far(v)+1.36*Math.sin(u*.17+v*.09)+.52*Math.sin(u*.34-v*.17)-50;
    return [x,z];
  }
  for(let row=-rows/2;row<=rows/2;row++)for(let col=-columns/2;col<=columns/2;col++){
    const u=(col+.5*(row&1))*440/columns,v=row*440/rows;
    const [x,z]=seaPoint(u,v);
    const seed=Math.sin(col*71.3+row*93.9)*17328.3;
    const grain=seed-Math.floor(seed);
    const tone=Math.max(0,Math.min(6,Math.floor(2.75+1.18*Math.sin(u*.18+v*.41)
      +.78*Math.cos(v*.32-u*.11)+(grain-.5)*2.3)))+grain*.92;
    const base=tones.length;
    for(const along of [-.26,.29]){
      const cross=.08*Math.sin(grain*17.+along*4.);
      const [px,pz]=seaPoint(u+along*440/columns,v+cross*440/rows);
      vertices.push(px,(along<0?.09:.035)+.12*grain,pz);
      brushCoords.push(along,cross);tones.push(tone);
    }
    for(const [dx,dz] of [[0,-2/3],[-.5,-1/3],[-.5,1/3],[0,2/3],[.5,1/3],[.5,-1/3]]){
      const [px,pz]=seaPoint(u+dx*440/columns,v+dz*440/rows);
      vertices.push(px,0,pz);brushCoords.push(dx,dz);tones.push(tone);
    }
    for(const index of [0,2,3,0,3,4,0,4,5,1,5,6,1,6,7,1,7,2,0,5,1,0,1,2])faces.push(base+index);
  }
  const seaBed=new T.Mesh(new T.PlaneGeometry(1450,1450),new T.MeshBasicMaterial({color:0x102d50}));
  seaBed.rotation.x=-Math.PI/2;seaBed.position.set(0,-.55,-50);scene.add(seaBed);
  const sheet=new T.BufferGeometry();
  sheet.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  sheet.setAttribute('paintTone',new T.Float32BufferAttribute(tones,1));
  sheet.setAttribute('brushUV',new T.Float32BufferAttribute(brushCoords,2));
  sheet.setIndex(faces);
  sheet.computeBoundingSphere();
  scene.add(new T.Mesh(sheet,oceanMaterial));

  function material(color,emissive=0,intensity=1){
    return new T.MeshStandardMaterial({color,emissive,emissiveIntensity:intensity,flatShading:true,roughness:.82,bumpMap:knifeRelief,bumpScale:.05});
  }
  function mesh(geometry,mat,x=0,y=0,z=0,parent=scene){
    const m=new T.Mesh(geometry,mat); m.position.set(x,y,z);parent.add(m);return m;
  }

  const splashes=Array.from({length:coarse?32:70},()=>({age:1}));
  const splashMesh=new T.InstancedMesh(pigmentStroke,material(0xffffff),splashes.length);
  splashMesh.count=0;splashMesh.frustumCulled=false;
  splashMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  scene.add(splashMesh);
  let splashCursor=0;
  const sprayColors=['#458fc6','#60b6d5','#93d9dc','#c5ead8','#f7db9b'].map(pigment);
  const earthChips=['#3a726c','#5a9483','#92b39a','#d7c48d'].map(pigment);
  const splashPose=new T.Object3D();
  function flingPaint(x,y,z,heading,strength,water){
    const forwardX=Math.sin(heading),forwardZ=-Math.cos(heading);
    const acrossX=Math.cos(heading),acrossZ=Math.sin(heading);
    const amount=water?Math.round((coarse?5:8)*strength)+2:3;
    for(let i=0;i<amount;i++){
      const p=splashes[splashCursor++%splashes.length],side=i%2?1:-1;
      const spread=(.42+random()*.91)*side,forward=(random()-.27)*strength;
      p.age=0;p.life=.39+random()*.32;p.water=water;
      p.x=x+acrossX*side*.24;p.y=y;p.z=z+acrossZ*side*.24;
      p.vx=acrossX*spread*(water?2.6:1.35)+forwardX*forward;
      p.vz=acrossZ*spread*(water?2.6:1.35)+forwardZ*forward;
      p.lift=(water?1.2: .52)+random()*(water?2.9:.71)*strength;
      p.angle=heading+(random()-.5)*2.8;p.spin=(random()-.5)*8;
      p.size=(water?.22:.10)+random()*(water?.43:.16)*strength;
      const palette=water?sprayColors:earthChips;
      p.color=palette[Math.floor(random()*palette.length)];
    }
  }
  function animatePaint(dt,reduced){
    let count=0;
    for(const p of splashes){
      if(reduced){p.age=1;continue;}
      if(!p.life||p.age>=p.life)continue;
      p.age+=dt;
      const t=p.age,fade=Math.max(0,1-(t/p.life)**3),size=p.size*fade;
      if(size<=0)continue;
      splashPose.position.set(p.x+p.vx*t,p.y+p.lift*t-(p.water?4.9:2.7)*t*t,p.z+p.vz*t);
      splashPose.rotation.set(.48+p.spin*t,p.angle+p.spin*t,.32+p.spin*.16*t);
      splashPose.scale.set(size*1.72,size*.60,size*.69);
      splashPose.updateMatrix();
      splashMesh.setMatrixAt(count,splashPose.matrix);splashMesh.setColorAt(count++,p.color);
    }
    splashMesh.count=count;
    if(count){splashMesh.instanceMatrix.needsUpdate=true;splashMesh.instanceColor.needsUpdate=true;}
  }
  function ribbon(points,width,mat,colors){
    const positions=[],indices=[];
    for(let i=0;i<points.length;i++){
      const p=points[i], a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)];
      const size=Math.hypot(b.x-a.x,b.z-a.z);
      const nx=(b.z-a.z)/size*width/2,nz=(a.x-b.x)/size*width/2;
      positions.push(p.x+nx,p.y,p.z+nz,p.x-nx,p.y,p.z-nz);
      if(i){const j=i*2;indices.push(j-2,j-1,j,j,j-1,j+1);}
    }
    const geo=faceMesh(positions,indices,i=>colors[Math.floor(i/6)%colors.length],(x,y,z,index)=>[Math.floor(index/2)*.33,index%2]);
    return mesh(geo,mat);
  }

  const island={x:-36,z:-60,rx:26,rz:20};
  const outerIslands=[
    {x:-125,z:-140,rx:33,rz:14,h:7},{x:102,z:-175,rx:36,rz:19,h:9},
    {x:165,z:29,rx:23,rz:16,h:8},{x:-118,z:35,rx:21,rz:14,h:5},
    {x:-29,z:14,rx:13,rz:24,h:3.6},{x:33,z:21,rx:15,rz:20,h:2.9}
  ];
  function radial(x,z,i=island){return Math.hypot((x-i.x)/i.rx,(z-i.z)/i.rz);}
  function height(x,z,i=island) {
    const r=radial(x,z,i), ridge=1.0-r*r;
    const variation=Math.sin((x-i.x)*.23)*Math.cos((z-i.z)*.31);
    return (i.y||0)-.47+Math.max(0,ridge)*(i.h||7.8)*(1+.18*variation);
  }
  const faceted=new T.MeshStandardMaterial({vertexColors:true,flatShading:true,side:T.DoubleSide,roughness:.86,bumpMap:knifeRelief,bumpScale:.16});
  const shorePigment=material(0xffffff);
  // Mix each touch once on the surface. Its three ridges carry the knife grain.
  const paintLight=new T.Vector3(-.62,.71,.33).normalize();
  const mixes={
    cypress:['#091c36','#194652','#497b80'],
    sail:['#651e43','#b33c48','#f69565'],
    earth:['#193449','#39736c','#8dac85'],
    timber:['#492e38','#985a42','#d7a259']
  };
  const strokeShapes=Array.from({length:8},(_,k)=>{
    const p=[],c=[],idx=[];
    for(let j=0;j<=5;j++)for(let i=0;i<4;i++){
      const u=j/5,v=i/3,belly=.28+.72*Math.sin(Math.PI*(.04+.92*u))**.64;
      p.push((u-.5)+.038*Math.sin(v*14+k),(.18+.68*Math.sin(Math.PI*v))*belly,
        (v-.5)*belly+.07*Math.sin(u*4+k));
      const h=i===1?1.13:i===3?.79:.98;c.push(h,h,h*(i===1?.96:1));
      if(i&&j){const n=j*4+i;idx.push(n,n-4,n-1,n-1,n-4,n-5);}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));
    g.setAttribute('color',new T.Float32BufferAttribute(c,3));g.setIndex(idx);return g;
  });
  const dryPaint=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide,toneMapped:false});
  const oil=renderer.capabilities.isWebGL2?PatchOilPaint.createShared():null;
  let pinnedMaterial;
  if(oil){
    oil.tBrush=brushAtlas;
    oil.uHazeDensity.value=.0018;
    pinnedMaterial=PatchOilPaint.dabMaterial(oil,{
      minPx:[.65,1.5],maxPx:[240,720],uniforms:pigmentLights,
      head:pigmentLighting+'in vec3 anchor, grainAxis, skinNormal, paintMix; in vec2 markSize;',
      body:`void makeDab(inout Dab d){
        d.pos=(modelMatrix*vec4(anchor,1.)).xyz;
        d.dir=normalize(mat3(modelMatrix)*grainAxis);
        d.nrm=normalize(mat3(modelMatrix)*skinNormal);
        d.size=markSize;d.lie=1.;d.height=.07*markSize.x;
        d.c1=hazed(litPigment(paintMix,d.nrm,d.pos),d.pos);
        d.c2=d.c1*vec3(1.14,1.095,1.045);
      }`
    });
  }
  function updateBrushScale(){
    lampLight.getWorldPosition(pigmentLights.lampPos.value);
    pigmentLights.lampInk.value.copy(lampLight.color).multiplyScalar(lampLight.intensity*.32);
    pigmentLights.moonDir.value.copy(moon.position).sub(moon.target.position).normalize();
    pigmentLights.moonInk.value.copy(moon.color).multiplyScalar(moon.intensity*.46);
    if(oil)oil.uPixel.value=2*Math.tan(camera.fov*Math.PI/360)/Math.max(1,renderer.domElement.height);
  }
  function pinPaint(surface,count,length,width,grain,colors){
    // Bake the parent's non-uniform scale into the sampling basis.
    const g=surface.geometry,pos=g.getAttribute('position'),ix=g.index;
    const points=[],areas=[];let area=0,seed=117+count;
    const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const read=i=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i):i).multiply(surface.scale);
    for(let k=0;k<(ix?ix.count:pos.count);k+=3){
      const a=read(k),b=read(k+1).sub(a),c=read(k+2).sub(a),n=b.clone().cross(c);
      if(n.lengthSq()<1e-10)continue;
      area+=n.length();points.push({a,b,c,n:n.normalize()});areas.push(area);
    }
    if(!area)return;
    const root=new T.Group();surface.add(root);
    root.scale.set(1/surface.scale.x,1/surface.scale.y,1/surface.scale.z);
    // Pack the variants into one draw call per surface.
    const xyz=[],rgb=[],indices=[];
    const anchors=[],axes=[],normals=[],inks=[],sizes=[];
    for(let i=0;i<count;i++){
      const pick=rand()*area;let lo=0,hi=areas.length-1;
      while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid]<pick)lo=mid+1;else hi=mid;}
      const {a,b,c,n}=points[lo];const u=Math.sqrt(rand()),v=rand();
      const at=a.clone().addScaledVector(b,u*(1-v)).addScaledVector(c,u*v);
      const normal=n.clone();
      if((colors===mixes.earth&&normal.y<0)||(colors===mixes.sail&&i%2))normal.negate();
      const dir=grain.clone().addScaledVector(normal,-grain.dot(normal));
      if(dir.lengthSq()<.001)dir.set(1,0,0).addScaledVector(normal,-normal.x);
      dir.normalize().applyAxisAngle(normal,(rand()-.5)*.32);
      const across=dir.clone().cross(normal),len=length*(.58+.8*rand()),wid=width*(.55+.78*rand());
      const lit=normal.clone().applyQuaternion(surface.quaternion).dot(paintLight)+(rand()-.5)*.22;
      const color=pigment(colors[lit>.44?2:lit>-.26?1:0]).clone().multiplyScalar(.87+.26*rand());
      if(oil){
        anchors.push(at.x,at.y,at.z);axes.push(dir.x,dir.y,dir.z);normals.push(normal.x,normal.y,normal.z);
        color.convertLinearToSRGB();inks.push(color.r,color.g,color.b);sizes.push(wid*1.65,len*1.20);
        continue;
      }
      const variant=strokeShapes[i%8],shape=variant.attributes.position,shade=variant.attributes.color;
      const offset=xyz.length/3;
      for(let j=0;j<shape.count;j++){
        const q=at.clone().addScaledVector(dir,shape.getX(j)*len).addScaledVector(across,shape.getZ(j)*wid)
          .addScaledVector(normal,wid*(.025+.12*shape.getY(j)));
        xyz.push(q.x,q.y,q.z);rgb.push(color.r*shade.getX(j),color.g*shade.getY(j),color.b*shade.getZ(j));
      }
      for(const j of variant.index.array)indices.push(offset+j);
    }
    if(oil){
      const buffer=(data,n)=>[new Float32Array(data),n];
      const cards=PatchOilPaint.dabGeometry(count,{anchor:buffer(anchors,3),grainAxis:buffer(axes,3),
        skinNormal:buffer(normals,3),paintMix:buffer(inks,3),markSize:buffer(sizes,2)});
      root.add(PatchOilPaint.dabMesh(cards,pinnedMaterial));return;
    }
    const batch=new T.BufferGeometry();batch.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
    batch.setAttribute('color',new T.Float32BufferAttribute(rgb,3));batch.setIndex(indices);
    root.add(new T.Mesh(batch,dryPaint));
  }
  const upGrain=new T.Vector3(0,1,0);
  function shoreStrokes(isle){
    const count=coarse?42:78;
    const patches=new T.InstancedMesh(pigmentStroke,shorePigment,count);
    const pose=new T.Object3D();
    for(let index=0;index<count;index++){
      const angle=index*tau/count;
      const reach=.73+.16*(.5+.5*Math.sin(index*2.61));
      const x=isle.x+Math.cos(angle)*isle.rx*reach,z=isle.z+Math.sin(angle)*isle.rz*reach;
      const length=isle.rx*(.07+.07*(index%7)/6);
      const rotation=-angle-Math.PI/2+.16*Math.sin(index*2.3);
      pose.position.set(x,height(x,z,isle)+.025,z);
      pose.rotation.set(0,rotation,0);
      pose.scale.set(length,.49,length*.38);
      pose.updateMatrix();
      patches.setMatrixAt(index,pose.matrix);
      patches.setColorAt(index,pigment(palette.earth[1+index%5]));
    }
    scene.add(patches);
  }
  function terrain(i){
    const vertices=[],idx=[],rings=22,segments=72;
    for(let j=0;j<=rings;j++)for(let k=0;k<=segments;k++){
      const a=k/segments*tau,r=.0001+j/rings*1.08;
      const edge=1+.045*Math.sin(a*5)+.022*Math.cos(a*9);
      const x=i.x+Math.cos(a)*r*i.rx*edge,z=i.z+Math.sin(a)*r*i.rz*edge;
      const y=height(x,z,i)-Math.max(0,r-1)*9;
      vertices.push(x,y,z);
      if(j&&k){const n=j*(segments+1)+k;idx.push(n,n-1,n-segments-1,n-1,n-segments-2,n-segments-1);}
    }
    const geometry=faceMesh(vertices,idx,face=>{
      const section=Math.floor(face/2);
      const ring=Math.floor(section/segments);
      const wedge=Math.floor((section%segments)/5);
      const layer=Math.floor(ring/2);
      const vein=Math.sin(wedge*1.85+layer*2.17)+Math.cos(wedge*.74-layer*.64);
      const shade=T.MathUtils.clamp(Math.floor(6-ring*.239+vein*.91),0,palette.earth.length-1);
      return palette.earth[shade];
    },(x,y,z)=>[x*.37+z*.11,z*.68]);
    const slope=mesh(geometry,faceted);
    pinPaint(slope,coarse?150:420,i.rx*.14,i.rx*.035,new T.Vector3(1,.1,.22).normalize(),mixes.earth);
  }
  terrain(island);
  shoreStrokes(island);
  for(const i of outerIslands.slice(0,4))terrain(i);
  const foliageSeed=seed;
  for(const i of outerIslands.slice(4))terrain(i);
  seed=foliageSeed;

  const pathCurve=new T.CatmullRomCurve3([[-21,-46],[-25,-52],[-34,-51],[-40,-55],[-37,-65],[-44,-69],[-49,-71]].map(([x,z])=>new T.Vector3(x,0,z)));
  const paths=pathCurve.getPoints(100).map(p=>new T.Vector3(p.x,height(p.x,p.z)+.069,p.z));
  ribbon(paths,1.7,faceted,palette.trail.slice(2));
  const stones=[material(0x5c9b9c),material(0xb2a77e)];
  for(let i=0;i<110;i++){
    const p=paths[Math.floor(random()*paths.length)];
    const size=.20+random()*.46;
    const stroke=mesh(pigmentStroke,stones[i%2],p.x+(random()-.5)*2,p.y,p.z+(random()-.5)*2);
    stroke.scale.set(size*2.2,size*.52,size);
    stroke.rotation.y=i*.53;
  }
  const dock={x:-19,z:-44.3, foot:new T.Vector3(-21,0,-46)};
  const wood=material(0x694837), trim=material(0xe2ad6f), darkWood=material(0x392218);
  const dockGroup=new T.Group();dockGroup.position.set(dock.x,.55,dock.z);dockGroup.rotation.y=-.7;scene.add(dockGroup);

  for(let k=0;k<13;k++)block(2.7,.17,.39,k%3?wood:trim,0,0,(k-6)*.4,dockGroup);
  for(const x of [-1.12,1.12])for(const z of [-2.4,0,2.4])block(.21,1.9,.21,wood,x,-.15,z,dockGroup);

  const foliage=[0x122e37,0x193d40,0x214b47,0x2b5650,0x34615c].map(c=>material(c));

  const trees=[], blockers=[];
  const treeLeaf=new T.IcosahedronGeometry(1,0);
  function tree(x,z,y,h,collision=false){
    const g=new T.Group();g.position.set(x,y,z);scene.add(g);
    block(.17,h*.60,.18,darkWood,0,h*.27,0,g);
    for(let i=0;i<5;i++){
      const f=mesh(treeLeaf,foliage[(i+Math.floor(random()*4))%5],(random()-.52)*h*.095,h*(.30+i*.125),(random()-.5)*h*.12,g);
      const width=h*(.155-i*.022);
      f.scale.set(width,h*(.31-i*.022),width*.86);f.rotation.y=random()*tau; f.rotation.z=(random()-.5)*.22;
      pinPaint(f,coarse?8:19,h*.14,h*.034,upGrain,mixes.cypress);
    }
    if(collision){blockers.push({x,z,r:.36+h*.031});trees.push(g);}
  }
  function tallCypress(x,z){
    const group=new T.Group();
    group.position.set(x,height(x,z),z);scene.add(group);
    const colors=['#071927','#0a2632','#133849','#23556a','#244652'];
    const boughs=[
      {x:0,z:0,base:.42,height:20,width:2.00,bend:.65},
      {x:-1.18,z:.20,base:.22,height:15.7,width:1.29,bend:-.79},
      {x:.91,z:.25,base:.36,height:13.8,width:1.38,bend:.86},
      {x:-1.70,z:.53,base:.20,height:9.8,width:1.03,bend:-.49},
      {x:1.50,z:.64,base:.08,height:7.7,width:.88,bend:.69}
    ];
    for(const [branch,bough] of boughs.entries()){
      const rings=17,sides=12,vertices=[],indices=[];
      for(let j=0;j<=rings;j++){
        const t=j/rings,lean=bough.x+bough.bend*t*t+.21*Math.sin(t*7+branch)*t;
        const radius=bough.width*(.48+.80*Math.sin(Math.PI*t)**.8)*(1-t)**.71+.046;
        for(let i=0;i<=sides;i++){
          const a=i*tau/sides,each=radius*(1+.18*Math.sin(a*3+t*15+branch));
          vertices.push(lean+Math.cos(a)*each,bough.base+t*bough.height,bough.z+Math.sin(a)*each*.77);
          if(j&&i){
            const n=j*(sides+1)+i;
            indices.push(n,n-sides-1,n-1,n-1,n-sides-1,n-sides-2);
          }
        }
      }
      const geometry=faceMesh(vertices,indices,(face,corners)=>{
        const edge=corners[0]%(sides+1);
        return colors[(edge+branch+(face%7===0?1:0))%colors.length];
      },(x,y,z)=>[y*.44,(x+z)*.63]);
      const crown=mesh(geometry,faceted,0,0,0,group);
      pinPaint(crown,coarse?110:245,bough.height*.105,bough.width*.30,upGrain,mixes.cypress);
    }
    block(.68,3,.61,darkWood,0,1.35,0,group);
    blockers.push({x,z,r:1.55});trees.push(group);
  }
  tallCypress(-29,-59.5);
  for(let i=0;i<87;i++){
    const x=island.x+(random()-.5)*49,z=island.z+(random()-.5)*36;
    if(radial(x,z)<.93&&paths.every(p=>Math.hypot(x-p.x,z-p.z)>2.0)&&Math.hypot(x+36,z+63)>4.3)tree(x,z,height(x,z),3+random()*9.5,true);
  }
  for(let i=0;i<36;i++){
    const distant={x:-125,z:-140,rx:33,rz:14,h:7};
    const x=distant.x+(random()-.5)*50,z=distant.z+(random()-.5)*12;
    tree(x,z,height(x,z,distant),3+random()*11);
  }

  const gold=material(0xffdfa0,0xdc9a33,1.6), teal=material(0xa9f3d7,0x59bcac,1.15);
  for(const x of [-1.12,1.12]) for(const z of [-2.4,2.4]) {
    block(.22,.31,.22,gold,x,.92,z,dockGroup);
  }

  // Each ring sets the outline of one overlapping band of paint.
  function paintedShell(parent,rings,sides,tones,x,y,z){
    const positions=[],indices=[];
    for(const [level,width,depth,shift=0] of rings){
      for(let i=0;i<sides;i++){
        const angle=i*2*Math.PI/sides;
        positions.push(Math.sin(angle)*width,level,Math.cos(angle)*depth+shift);
      }
    }
    for(let row=1;row<rings.length;row++)for(let i=0;i<sides;i++){
      const a=(row-1)*sides+i,b=(row-1)*sides+(i+1)%sides;
      indices.push(a,b,b+sides,a,b+sides,a+sides);
    }
    const top=(rings.length-1)*sides;
    for(let i=1;i<sides-1;i++)indices.push(0,i+1,i,top,top+i,top+i+1);
    const geometry=faceMesh(positions,indices,face=>{
      const band=Math.floor(face/(2*sides)),side=Math.floor(face/2)%sides;
      return tones[(band+Math.floor(side/2)+(face%2 && side%3===0?1:0))%tones.length];
    },(px,py,pz)=>[px+pz*.65,py]);
    return mesh(geometry,faceted,x,y,z,parent);
  }
  const boat=new T.Group();scene.add(boat);
  paintedShell(boat,[[-.49,.15,1.26],[-.32,.64,1.84],[-.09,.81,2.02],
    [.03,.86,2.09],[.18,.92,2.15],[.32,.91,2.10]],12,
    ['#45313b','#713f39','#a35e40','#c2834e','#794838'],0,0,0);
  paintedShell(boat,[[.12,.915,2.15],[.19,.935,2.17]],12,
    ['#1c416b','#32648b','#598caa'],0,0,0);
  mesh(new T.CylinderGeometry(.91,.81,.16,10),wood,0,.25,0,boat).scale.z=2.24;
  const rim=mesh(new T.TorusGeometry(.905,.045,4,10),trim,0,.34,0,boat);rim.rotation.x=Math.PI/2;rim.scale.y=2.29;
  for(let i=-6;i<=6;i++){
    const z=i*.275, beam=1.67*Math.sqrt(1-(z/2.08)**2);
    const plank=block(beam,.065,.278,i%3?wood:trim,0,.341,z,boat);
    pinPaint(plank,coarse?7:14,.24,.028,new T.Vector3(1,0,0),mixes.timber);
  }
  block(1.35,.16,.31,trim,0,.56,.86,boat);
  block(.1,4.33,.11,trim,0,2.27,-.36,boat);
  const sail=new T.Group();sail.position.set(0,0,-.36);boat.add(sail);
  block(.082,.085,2.45,trim,0,1.03,1.15,sail);
  function sailPoint(v,u,lift){
    const arch=Math.sin(Math.PI*v),reach=2.47*(1-u)**.86+.012;
    const fold=Math.sin(v*38+.9*u);
    return [.65*arch*Math.sin((.22+.74*u)*Math.PI)+.042*fold*(1-u)+lift,
      1.09+3.29*u+.11*arch*(1-u),v*reach-.10*Math.sin(u*Math.PI)];
  }
  const clothRed=['#501a35','#76213c','#982941','#b93742','#d24a49','#e66653','#ef8867'];
  const sailVerts=[],sailFaces=[],sailTones=[];
  function sailPatch(left,right,low,high,side,shade,thick){
    const base=sailVerts.length/3;
    const toe=.014*Math.sin(left*156+low*27)*(1-high);
    for(const [v,u,h] of [[left,high,0],[right,high,0],
      [left,low,thick],[right,Math.max(0,low+toe),thick*.86],
      [left,low,0],[right,Math.max(0,low+toe),0]]){
      sailVerts.push(...sailPoint(v,u,side*(h+(thick?.012:0))));
    }
    for(const index of [0,2,1,1,2,3,2,4,3,3,4,5])sailFaces.push(base+index);
    sailTones.push(shade,shade,clothRed[0],clothRed[0]);
  }
  // Continuous dark cloth backs the raised, downward-lapped strokes on both faces.
  for(let i=0;i<18;i++)for(let j=0;j<14;j++)
    sailPatch(i/18,(i+1)/18,j/14,(j+1)/14,1,clothRed[1],0);
  for(const side of [-1,1])for(let i=0;i<18;i++){
    const rows=8+(i*7)%4,left=i/18,right=(i+1)/18;
    const seam=j=>(j+(j>0&&j<rows?.29*Math.sin(i*3.71+j*2.13):0))/rows;
    for(let j=0;j<rows;j++){
      const shade=.50+.24*Math.cos(i*.88)+.17*Math.sin(j*2.19+i*3.83);
      const thick=.018+.018*(.5+.5*Math.sin(i*4.3+j));
      sailPatch(left,Math.min(1,right+.002),Math.max(0,seam(j)-.012),
        seam(j+1),side,clothRed[Math.round(shade*6)],thick);
    }
  }
  mesh(faceMesh(sailVerts,sailFaces,f=>sailTones[f],(x,y,z)=>[z,y]),faceted,0,0,0,sail);
  block(.16,.16,.16,gold,0,4.47,-.36,boat).rotation.z=Math.PI/4;
  lampLight.position.set(0,1.18,-1.81);boat.add(lampLight);
  const lamp=material(0xffdb87,0xffad42,1.3);
  block(.13,.72,.14,trim,0,.63,-1.81,boat);
  paintedShell(boat,[[0,.09,.09],[.07,.16,.16],[.28,.13,.13],[.32,.08,.08]],6,
    ['#bb874e','#e7aa57','#895234'],0,.95,-1.81);
  mesh(new T.CylinderGeometry(.15,.165,.18,6),lamp,0,1.12,-1.81,boat);
  const tiller=block(.09,.09,.78,trim,-.42,.98,1.46,boat);
  tiller.rotation.x=.23;
  const person=new T.Group();scene.add(person);
  const indigo=['#183859','#245478','#326a89','#407c91'];
  const seaGlass=['#1c426b','#295985','#4078a0','#6298b7'];
  const saffron=['#a85d2e','#d78d3d','#edb45b','#ffcf78'];
  const leather=material(0x733e32), mitt=material(0xb77947);
  paintedShell(person,[[.52,.30,.21],[.63,.29,.22],[.91,.21,.17],[1.19,.29,.18],
    [1.28,.16,.14]],10,indigo,0,0,0);
  paintedShell(person,[[.97,.34,.25,.025],[1.11,.35,.22],[1.28,.21,.16]],
    10,seaGlass,0,0,0);
  paintedShell(person,[[1.22,.18,.15],[1.32,.20,.17]],8,saffron,0,0,0);
  const kerchief=block(.12,.30,.045,material(0xe6a447),.10,1.10,.235,person);
  kerchief.rotation.z=.28;
  paintedShell(person,[[1.30,.12,.12],[1.44,.166,.145],[1.58,.14,.13]],8,
    ['#895d50','#b67d5b','#ce956a'],0,0,-.015);
  paintedShell(person,[[1.48,.23,.20],[1.53,.245,.215],[1.55,.185,.16],
    [1.65,.17,.15,.025],[1.70,.095,.095,.06]],9,saffron,0,0,0);
  function joint(x,y){
    const pivot=new T.Group();pivot.position.set(x,y,0);person.add(pivot);return pivot;
  }
  // Short knife marks overlap down the folds; a continuous lining fills the seams.
  const cloth=[],weights=[],clothColors=[],clothFaces=[];
  const blues=['#0b1530','#102343','#15325b','#194371','#205889','#2a6ba5','#3587bc','#50a0ca'];
  const panels=45;
  function clothNoise(i,j){
    const n=Math.sin(i*91.7+j*47.3)*47323.1;
    return n-Math.floor(n);
  }
  function clothPoint(a,v,relief,tint){
    const shoulder=Math.min(1,v/.21);
    const fold=Math.cos(a*13+.48*v);
    const r=.227+.142*Math.sin(shoulder*Math.PI*.5)+.066*v+fold*.019+relief;
    cloth.push(Math.sin(a)*r,1.32-v*(.94+.04*Math.cos(a)),
      Math.cos(a)*r*.78+.035+.073*v*v);
    weights.push(Math.min(1,v),a);
    const c=pigment(tint);clothColors.push(c.r,c.g,c.b);
  }
  function dab(left,right,top,bottom,thickness,tint,slant){
    const i=weights.length/2;
    clothPoint(left,top,thickness,tint);clothPoint(right,top,thickness,tint);
    clothPoint(left+slant,bottom,thickness+.003,tint);
    clothPoint(right+slant,bottom-.009,thickness+.009,tint);
    clothFaces.push(i,i+1,i+2,i+2,i+1,i+3);
  }
  for(let i=0;i<panels;i++){
    const left=(i/panels-.5)*5.18,right=((i+1)/panels-.5)*5.18;
    const hem=.93+.073*clothNoise(i,1)+.026*Math.cos(left*8);
    for(let j=0;j<8;j++)dab(left,right,j*hem/8,(j+1)*hem/8+.012,0,blues[1],0);
    const rows=6+Math.floor(clothNoise(i,2)*4);
    for(let j=0;j<rows;j++){
      const start=k=>hem*(k+(k===0||k===rows?0:(clothNoise(i,k+4)-.5)*.63))/rows;
      const light=.48-.33*Math.sin(left)+.17*Math.cos(left*13+.48*j/rows);
      const shade=T.MathUtils.clamp(Math.floor(7*light+2*(clothNoise(i,j+17)-.5)),0,7);
      dab(left-.006,right+.003,start(j),start(j+1)+.016,.012+.01*clothNoise(i,j+31),
        blues[shade],.012*Math.sin(i+j));
    }
  }
  const cape=new T.BufferGeometry();
  cape.setAttribute('position',new T.Float32BufferAttribute(cloth,3));
  cape.setAttribute('drape',new T.Float32BufferAttribute(weights,2));
  cape.setAttribute('color',new T.Float32BufferAttribute(clothColors,3));cape.setIndex(clothFaces);
  const capePull=new T.Vector3();
  const cloakMaterial=new T.ShaderMaterial({vertexColors:true,side:T.DoubleSide,extensions:{derivatives:true},uniforms:{...pigmentLights,brushAtlas,time:tide,pull:{value:capePull}},
    vertexShader:`
      uniform float time; uniform vec3 pull; varying vec3 clothWorld,clothOutside; attribute vec2 drape; varying vec3 ink; varying vec2 clothUV;
      varying float sheen;
      void main(){
        float v=drape.x,a=drape.y;
        float gust=sin(time*1.6-v*2.8+a*.75)+.35*sin(time*.91+a*2.1);
        vec3 pos=position;
        pos.x+=v*v*.092*gust;pos.z+=v*v*(.065+.057*sin(time*1.6-v*3.+a));
        float hem=v*v;
        float drag=length(pull.xz);
        float ripple=sin(time*6.-v*5.+a*2.)*.045*drag;
        pos.x+=hem*(pull.x+pull.y*cos(a)+ripple);
        pos.z+=hem*(pull.z-pull.y*sin(a)+ripple*cos(a));
        pos.y+=hem*(.021*gust+.28*drag+.05*abs(pull.y));ink=color;clothUV=drape;sheen=.75+.25*gust;
        clothWorld=(modelMatrix*vec4(pos,1.)).xyz;
        clothOutside=mat3(modelMatrix)*vec3(sin(a),.2,cos(a));
        gl_Position=projectionMatrix*viewMatrix*vec4(clothWorld,1.);
      }`,
    fragmentShader:`

      ${sampleBrush}
      ${pigmentLighting}
      varying vec3 clothWorld,clothOutside;
      varying vec3 ink; varying vec2 clothUV; varying float sheen;
      void main(){
        float edge=min(1.-clothUV.x,(2.59-abs(clothUV.y))*.40);
        float glow=exp(-max(0.,edge)*30.)*sheen;
        float fold=cos(clothUV.y*9.1+.48*clothUV.x);
        vec2 weave=vec2((clothUV.y+2.59)*8.7,clothUV.x*7.);
        vec3 mark=loadedBrush(fract(weave),mod(floor(weave.x)+3.*floor(weave.y),8.));
        vec3 n=normalize(cross(dFdx(clothWorld),dFdy(clothWorld)));
        if(dot(n,clothOutside)<0.)n=-n;
        vec3 base=ink*(.84+.24*fold+mark.g*(.24*mark.r+.19*mark.b));
        gl_FragColor=vec4(litPigment(base,n,clothWorld)+vec3(.014,.052,.105)*glow,1.);
        #include <colorspace_fragment>
      }`});
  mesh(cape,cloakMaterial,0,0,0,person);
  const legs=[-.12,.12].map(x=>{
    const pivot=joint(x,.65);
    paintedShell(pivot,[[-.48,.075,.08],[-.25,.09,.095],[0,.103,.105]],7,indigo,0,0,0);
    block(.15,.18,.22,leather,0,-.55,-.027,pivot);
    return pivot;
  });
  const arms=[-.28,.28].map(x=>{
    const pivot=joint(x,1.17);
    paintedShell(pivot,[[-.36,.072,.075],[-.22,.096,.10],[0,.112,.115]],7,seaGlass,0,0,0);
    block(.13,.12,.14,mitt,0,-.397,0,pivot);
    return pivot;
  });
  const seat=new T.Vector3(-35,height(-35,-64),-64);
  const bench=new T.Group();bench.position.copy(seat);scene.add(bench);
  block(1.55,.12,.56,trim,0,.55,0,bench);
  for(const x of [-.57,.57])block(.12,.55,.4,wood,x,.27,0,bench);
  const plant=new T.Vector3(-33,height(-33,-57),-57);
  const flowers=new T.Group();flowers.position.copy(plant);scene.add(flowers);
  for(let i=0;i<12;i++){
    const x=(random()-.5)*1.8,z=(random()-.5)*1.8,h=.24+random()*.76;
    mesh(new T.CylinderGeometry(.018,.025,h,5),foliage[3],x,h/2,z,flowers);
    mesh(new T.OctahedronGeometry(.07+random()*.075),teal,x,h,z,flowers);
  }

  const ripples=[];
  for(let i=0;i<8;i++){
    const r=mesh(new T.TorusGeometry(2+i*1.7,.035,4,20),new T.MeshBasicMaterial({color:i%2?0xcae1c2:0xeac67e,transparent:true,opacity:.25,depthWrite:false}),vortex.x,.28,vortex.z);
    r.rotation.x=Math.PI/2;ripples.push(r);
  }

  return {scene,camera,renderer,updateBrushScale,sky,animateSky,tide,capePull,hullCenter,lampWater,markWake,advanceWake,waveHit,flingPaint,animatePaint,vortex,island,outerIslands,dock,radial,height,
    boat,sail,person,arms,legs,trees,blockers,plant,flowers,seat,ripples};
})();
