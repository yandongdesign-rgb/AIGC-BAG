const library=import('../vendor/vision_bundle.mjs');
let detector;
self.onmessage=async({data})=>{try{if(data.type==='init'){
 const {FilesetResolver,HandLandmarker}=await library; const files=await FilesetResolver.forVisionTasks(new URL('../vendor/wasm/',self.location.href).href);
 const options={baseOptions:{modelAssetPath:new URL('../vendor/hand_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:data.confidence,minHandPresenceConfidence:data.confidence,minTrackingConfidence:data.confidence};
 detector=await HandLandmarker.createFromOptions(files,options);postMessage({type:'ready'});
 }else if(data.type==='frame'){const start=performance.now();try{const r=detector.detectForVideo(data.bitmap,data.time);postMessage({type:'result',landmarks:r.landmarks,world:r.worldLandmarks,handedness:r.handedness,latency:performance.now()-start,time:data.time});}finally{data.bitmap.close();}}
 }catch(error){postMessage({type:'error',message:error.message});}};

