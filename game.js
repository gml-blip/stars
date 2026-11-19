'use strict';
(() => {
  const w=World;
  const T=THREE, clamp=T.MathUtils.clamp, lerp=T.MathUtils.lerp, tau=Math.PI*2;
  const boat=w.boat, person=w.person, camera=w.camera;
  const boatPosition=new T.Vector3(0,0,8), foot=new T.Vector3();
  const configKey='star-sea-settings';
  let saved={};
  try { saved=JSON.parse(localStorage.getItem(configKey))||{}; } catch {}
  const settings={
    volume:Number.isFinite(saved.volume)?clamp(saved.volume,0,1):.55,
    reduced:saved.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches
  };
  let audio, master, wind, windFilter, pad, noiseBuffer, nextNote=0, note=0;
  function beginAudio(){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    if(audio){audio.resume().catch(()=>{});return;}
    audio=new Audio();
    master=audio.createGain();master.gain.value=settings.volume*.64;master.connect(audio.destination);
    const buffer=audio.createBuffer(1,audio.sampleRate*3,audio.sampleRate);
    noiseBuffer=buffer;
    const samples=buffer.getChannelData(0);
    let smooth=0;
    for(let i=0;i<samples.length;i++){smooth=smooth*.84+(Math.random()-.5)*.16;samples[i]=smooth;}
    const breeze=audio.createBufferSource();breeze.buffer=buffer;breeze.loop=true;
    windFilter=audio.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=390;
    wind=audio.createGain();wind.gain.value=.1;
    breeze.connect(windFilter).connect(wind).connect(master);breeze.start();
    pad=audio.createGain();pad.gain.value=.016;pad.connect(master);
    for(const hz of [55,82.41,110.15,164.6]){
      const osc=audio.createOscillator();osc.frequency.value=hz;osc.connect(pad);osc.start();
    }
    audio.resume().catch(()=>{});
  }
  function tone(midi,start,length,volume){
    if(!audio)return;
    const fund=440*2**((midi-69)/12);
    for(const [partial,weight] of [[1,1],[2,.21],[3,.085]]){
      const oscillator=audio.createOscillator(), envelope=audio.createGain();
      oscillator.frequency.value=fund*partial;oscillator.connect(envelope);envelope.connect(master);
      envelope.gain.setValueAtTime(.0001,start);
      envelope.gain.exponentialRampToValueAtTime(volume*weight,start+.035);
      envelope.gain.exponentialRampToValueAtTime(.0001,start+length/Math.sqrt(partial));
      oscillator.start(start);oscillator.stop(start+length+.025);
    }
  }
  function chime(notes,volume=.055){
    if(!audio)return;
    notes.forEach((n,i)=>tone(n,audio.currentTime+.13*i,2.4,volume));
  }
  function contactSound(strength,water){
    if(!audio||settings.volume===0)return;
    const at=audio.currentTime;
    const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
    source.buffer=noiseBuffer;
    filter.type='bandpass';filter.frequency.value=water?470+360*strength:270;filter.Q.value=.72;
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(.034+strength*.096,at+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,at+(water?.24:.13));
    source.connect(filter).connect(gain).connect(master);
    source.start(at,Math.random()*2,water?.27:.15);
  }
  function updateAudio(whirl){
    if(!audio)return;
    const now=audio.currentTime;
    master.gain.setTargetAtTime(settings.volume*.64,now,.18);
    wind.gain.setTargetAtTime(.105+Math.abs(speed)*.025+whirl*.10,now,.36);
    windFilter.frequency.setTargetAtTime(340+Math.abs(speed)*32+whirl*260,now,.55);
    pad.gain.setTargetAtTime(.015+whirl*.019,now,.55);
    if(now>=nextNote){
      const melody=whirl>.38?[60,64,69,71,76,71,67,64]:[57,64,69,72,71,64,67,62,60,67,74,69];
      tone(melody[note++%melody.length],now+.025,3.5,.047);
      if(note%4===1)tone(whirl>.38?48:45,now+.09,4.1,.032);
      nextNote=now+(whirl>.38?1.03:1.54)+(note%3)*.23;
    }
  }

  const keys=new Set();
  const touch={id:null,x:0,y:0};
  let afloat=true,speed=0,heading=0,walkHeading=0,orbit=0,pitch=.25,clock=0,motion=0;
  let sailDistance=0,wakeDistance=0,stepDistance=0,lastContact=-Infinity,hullKick=0;
  let dockReady=true,moveOrigin=null;
  const viewTarget=new T.Vector3(), desiredCamera=new T.Vector3(), desiredTarget=new T.Vector3();
  const canvas=w.renderer.domElement;
  let last=performance.now(), dragging=null;
  const moveKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
  function resetInput(){keys.clear();touch.id=null;touch.x=touch.y=0;dragging=moveOrigin=null;}
  window.addEventListener('blur',resetInput);
  document.addEventListener('visibilitychange',resetInput);
  document.querySelector('#start').addEventListener('click',beginAudio);
  document.querySelector('#show-help').addEventListener('click',resetInput);
  window.addEventListener('keydown',e=>{
    if(document.querySelector('#welcome').open)return;
    if(moveKeys.has(e.code)){e.preventDefault();keys.add(e.code);if(!audio)beginAudio();}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    if(!audio)beginAudio();
    if(e.pointerType==='touch'&&e.clientX<innerWidth*.5&&touch.id===null){
      touch.id=e.pointerId;moveOrigin={x:e.clientX,y:e.clientY};
    }else if(!dragging){dragging={id:e.pointerId,x:e.clientX,y:e.clientY};}else return;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(touch.id===e.pointerId){
      const dx=e.clientX-moveOrigin.x,dy=e.clientY-moveOrigin.y,r=Math.max(46,Math.hypot(dx,dy));
      touch.x=dx/r;touch.y=dy/r;
    }else if(dragging?.id===e.pointerId){
      orbit-=(e.clientX-dragging.x)*.006;pitch=clamp(pitch+(e.clientY-dragging.y)*.004,-.32,1.14);
      dragging.x=e.clientX;dragging.y=e.clientY;
    }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{
    if(touch.id===e.pointerId){touch.id=null;touch.x=touch.y=0;}
    if(dragging?.id===e.pointerId)dragging=null;
  });
  window.addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();w.renderer.setSize(innerWidth,innerHeight);
  });

  function distance(p,x,z){return Math.hypot(p.x-x,p.z-z);}
  function water(x,z){
    return .19*Math.sin(x*.27+z*.19-motion*.68)+.09*Math.cos(z*.53+x*.08+motion*.52);
  }
  function roomForBoat(x,z){
    return Math.hypot(x,z+65)<232 && w.radial(x,z)>=1.032 &&
      w.outerIslands.every(i=>Math.hypot((x-i.x)/(i.rx+2),(z-i.z)/(i.rz+2))>=1);
  }
  function ground(x,z,previous){
    if(w.radial(x,z)<.935)return w.height(x,z);
    return null;
  }
  function roomForFoot(x,z){
    if(w.blockers.some(o=>Math.hypot(x-o.x,z-o.z)<o.r) || distance(w.seat,x,z)<.57)return null;
    return ground(x,z,foot.y);
  }
  function angleDelta(a){return Math.atan2(Math.sin(a),Math.cos(a));}
  function brushContact(strength,atSea,side=0){
    if(clock-lastContact<.16)return;
    lastContact=clock;
    contactSound(strength,atSea);
    if(settings.reduced)return;
    if(atSea){
      const end=speed<0?-1.48:1.70;
      const x=boatPosition.x+Math.sin(heading)*end+Math.cos(heading)*side;
      const z=boatPosition.z-Math.cos(heading)*end+Math.sin(heading)*side;
      w.flingPaint(x,water(x,z)+.27,z,heading,strength,true);
      w.waveHit.value.set(x,z,0,strength);
      hullKick=Math.max(hullKick,strength);
    }else{
      w.flingPaint(foot.x,foot.y+.065,foot.z,walkHeading,strength,false);
    }
  }

  function updateGame(dt){
    const key=(a,b)=>Number(keys.has(a)||keys.has(b));
    const lr=clamp(key('KeyD','ArrowRight')-key('KeyA','ArrowLeft')+touch.x,-1,1);
    const fb=clamp(key('KeyW','ArrowUp')-key('KeyS','ArrowDown')-touch.y,-1,1);
    if(afloat){
      const startX=boatPosition.x,startZ=boatPosition.z;
      heading+=lr*1.38*dt;
      speed=lerp(speed,fb*(fb<0?6.4:14.2),1-Math.exp(-2.4*dt));
      const dx=Math.sin(heading)*speed*dt, dz=-Math.cos(heading)*speed*dt;
      const x=boatPosition.x+dx,z=boatPosition.z+dz;
      const openWater=roomForBoat(x,z);
      const incoming=Math.abs(speed);
      if(openWater){boatPosition.x=x;boatPosition.z=z;}
      else if(roomForBoat(x,boatPosition.z)){boatPosition.x=x;speed*=.83;}
      else if(roomForBoat(boatPosition.x,z)){boatPosition.z=z;speed*=.83;}
      else speed*=.6;
      const movedX=boatPosition.x-startX,movedZ=boatPosition.z-startZ;
      const traveled=Math.hypot(movedX,movedZ);
      sailDistance+=traveled;
      if(settings.reduced||speed<=0){
        wakeDistance=0;
      }else if(traveled>dt*1.1){
        wakeDistance+=traveled;
        if(wakeDistance>=2.45){
          const alongX=movedX/traveled,alongZ=movedZ/traveled;
          const offset=(wakeDistance-2.45)/traveled;
          w.markWake(lerp(boatPosition.x,startX,offset)-alongX*1.87,
            lerp(boatPosition.z,startZ,offset)-alongZ*1.87,alongX,alongZ);
          wakeDistance-=2.45;
        }
      }
      if(!openWater&&incoming>2.5&&clock-lastContact>.48){
        brushContact(clamp(incoming/10,.5,1),true);
        sailDistance=0;
      }else if(sailDistance>3.65&&incoming>1.65){
        brushContact(clamp(incoming/14.2,.28,1),true,lr*.43);
        sailDistance=0;
      }
    }else if(Math.hypot(lr,fb)>.035){
      const startX=foot.x,startZ=foot.z;
      const length=Math.max(1,Math.hypot(lr,fb)), dx=(Math.cos(orbit)*lr+Math.sin(orbit)*fb)*5.6*dt/length;
      const dz=(Math.sin(orbit)*lr-Math.cos(orbit)*fb)*5.6*dt/length;
      walkHeading+=angleDelta(Math.atan2(dx,-dz)-walkHeading)*Math.min(1,dt*10);
      const targetX=foot.x+dx,targetZ=foot.z+dz;
      let y=roomForFoot(targetX,targetZ);
      if(y!==null)foot.set(targetX,y,targetZ);
      else if((y=roomForFoot(targetX,foot.z))!==null)foot.set(targetX,y,foot.z);
      else if((y=roomForFoot(foot.x,targetZ))!==null)foot.set(foot.x,y,targetZ);
      stepDistance+=Math.hypot(foot.x-startX,foot.z-startZ);
      if(stepDistance>1.45){brushContact(.44,false);stepDistance=0;}
    }

    const dock=w.dock;
    if(afloat){
      const range=distance(boatPosition,dock.x,dock.z);
      if(range>6)dockReady=true;
      if(dockReady&&range<4.5&&Math.abs(speed)>.8){
        afloat=false;speed=0;foot.copy(dock.foot);foot.y=w.height(foot.x,foot.z);orbit=-.72;dockReady=false;
      }
    }else{
      const range=distance(foot,dock.foot.x,dock.foot.z);
      if(range>3)dockReady=true;
      if(dockReady&&range<1.9){
        afloat=true;dockReady=false;heading=Math.atan2(boatPosition.x-w.island.x,w.island.z-boatPosition.z);orbit=0;
      }
    }
    const stride=!afloat?Math.min(1,Math.hypot(lr,fb)):0;
    for(let i=0;i<2;i++){
      const swing=Math.sin(clock*10+i*Math.PI)*stride*(settings.reduced?.18:.64);
      w.legs[i].rotation.x=afloat?(i===0?.16:-.20):swing;
      w.arms[i].rotation.x=afloat?(i===0?.42:.13):-swing*.6;
    }
  }

  const previousCapePosition=new T.Vector3(), capeTarget=new T.Vector3();
  const capeOffset=new T.Vector3(), capeVelocity=new T.Vector3();
  let previousCapeYaw=0,previousCapeMode='';
  function updateCape(dt){
    const mode=afloat?'sail':'walk';
    const yaw=-(afloat?heading:walkHeading);
    if(mode!==previousCapeMode||settings.reduced){
      capeOffset.set(0,0,0);capeVelocity.set(0,0,0);w.capePull.set(0,0,0);
    }else if(dt>0){
      capeTarget.subVectors(previousCapePosition,person.position);
      capeTarget.y=0;
      capeTarget.multiplyScalar(.11/dt).clampLength(0,.77);
      capeTarget.y=clamp(-angleDelta(yaw-previousCapeYaw)*.095/dt,-.28,.28);
      // Integrate world-space drag in small steps so a heading change preserves inertia.
      const steps=Math.ceil(dt/(1/90)),h=dt/steps;
      for(let i=0;i<steps;i++){
        capeVelocity.addScaledVector(capeTarget,58*h).addScaledVector(capeOffset,-58*h);
        capeVelocity.multiplyScalar(Math.exp(-9*h));capeOffset.addScaledVector(capeVelocity,h);
      }
      const c=Math.cos(yaw),s=Math.sin(yaw);
      w.capePull.set(c*capeOffset.x-s*capeOffset.z,capeOffset.y,s*capeOffset.x+c*capeOffset.z);
    }
    previousCapePosition.copy(person.position);previousCapeYaw=yaw;previousCapeMode=mode;
  }

  function render(dt){
    const anim=settings.reduced?0:1, t=motion;
    const seaLevel=water(boatPosition.x,boatPosition.z);
    w.hullCenter.set(boatPosition.x,boatPosition.z);
    w.lampWater.set(boatPosition.x+1.81*Math.sin(heading),boatPosition.z-1.81*Math.cos(heading));
    const kick=afloat?anim*hullKick:0;
    boat.position.set(boatPosition.x,seaLevel+.13+kick*.049,boatPosition.z);
    boat.rotation.set(anim*Math.cos(t*.92)*.048+kick*.042,-heading,anim*Math.sin(t*1.11)*.055,'YXZ');
    w.sail.rotation.y=.54+anim*Math.sin(t*1.27)*.095;
    const pose=afloat?boat.localToWorld(new T.Vector3(-.36,.39,1.49)):foot;
    person.position.copy(pose); person.rotation.y=-(afloat?heading:walkHeading);
    if(afloat)person.quaternion.copy(boat.quaternion);
    else person.rotation.set(0,person.rotation.y,0);

    updateCape(dt);
    for(let i=0;i<w.trees.length;i++)w.trees[i].rotation.z=anim*Math.sin(t*.67+i*1.33)*.022;
    w.tide.value=t;
    for(let i=0;i<w.ripples.length;i++){
      w.ripples[i].scale.setScalar(1+Math.sin(t*.47+i*.6)*.031);
      w.ripples[i].material.opacity=.29+.07*Math.sin(t*.78+i*.52);
    }
    {
      const p=afloat?boatPosition:foot, yaw=afloat?heading+orbit:orbit;
      const range=afloat?9.2:5.5, height=afloat?2.1:1.23;
      const horizontal=Math.cos(pitch)*range, dx=Math.sin(yaw), dz=-Math.cos(yaw);
      desiredTarget.set(p.x+dx*(afloat?1.6:.65),p.y+height,p.z+dz*(afloat?1.6:.65));
      desiredCamera.set(p.x-dx*horizontal,Math.max(1.05,p.y+height+Math.sin(pitch)*range),p.z-dz*horizontal);
      if(!afloat){
        const groundBelowCamera=ground(desiredCamera.x,desiredCamera.z,p.y);
        if(groundBelowCamera!==null)desiredCamera.y=Math.max(desiredCamera.y,groundBelowCamera+.83);
      }
    }
    const smooth=!settings.reduced?1-Math.exp(-dt*7):1;
    camera.position.lerp(desiredCamera,smooth);viewTarget.lerp(desiredTarget,smooth);camera.lookAt(viewTarget);
    w.sky.position.copy(camera.position);w.sky.rotation.y=t*.00037;
    w.updateBrushScale();w.animateSky(t);
    w.renderer.render(w.scene,camera);
  }

  function frame(now){
    const dt=clamp((now-last)/1000,0,.049);last=now;
    if(!document.hidden){
      if(!settings.reduced)motion+=dt;
      {
        clock+=dt;updateGame(dt);
        hullKick*=Math.exp(-dt*11);
        const impact=w.waveHit.value;
        if(settings.reduced)impact.w=0;
        impact.z=Math.min(1,impact.z+dt*1.58);
        w.animatePaint(dt,settings.reduced);
        w.advanceWake(dt,settings.reduced);

      }
    }
    if(audio)updateAudio(Math.exp(-distance(boatPosition,w.vortex.x,w.vortex.z)*.058));
    render(dt);
    requestAnimationFrame(frame);
  }
  render(1);
  requestAnimationFrame(frame);
})();
