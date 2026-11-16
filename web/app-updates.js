const RELEASE=/^[a-f0-9]{24}$/;
const ATTEMPT_KEY='paro-app-update-attempt';

export function releaseUrl(href,version,view){
 if(!RELEASE.test(version))throw Error('Invalid app release');
 const url=new URL(href);url.searchParams.set('_paro_release',version);
 if(['control','status','statistics','absence','settings'].includes(view))url.searchParams.set('view',view);
 return url.href;
}

// This only checks public app files. It never touches Firebase, auth or controls.
export class AppUpdates{
 constructor({version,fetch:network=globalThis.fetch.bind(globalThis),now=()=>Date.now(),storage,requestedVersion=null,visible=()=>true,block=()=>'',reload,changed=()=>{},workerUpdate=async()=>{}}){
  Object.assign(this,{version,network,now,storage,visible,block,reload,changed,workerUpdate});
  this.available=null;this.checking=false;this.message='';this.checkedAt=0;this.lastCheck=-Infinity;this.lastReload=requestedVersion;
 }
 async check({manual=false,automatic=false}={}){
  if(this.checking||(!manual&&(!this.visible()||this.now()-this.lastCheck<15000)))return;
  this.checking=true;this.lastCheck=this.now();this.message="Checking app version …";this.changed();
  // Updating an existing push worker preserves its subscription and permissions.
  Promise.resolve().then(()=>this.workerUpdate()).catch(()=>{});
  let verified=false;
  try{
   const response=await this.network('/app-version.json?check='+this.now(),{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error();
   const text=await response.text();if(text.length>1024)throw Error();
   const release=JSON.parse(text);if(!RELEASE.test(release.version)||!Number.isFinite(Date.parse(release.builtAt)))throw Error();
   this.checkedAt=this.now();verified=true;
   if(release.version===this.version){this.available=null;this.message="You are using the latest app version.";}
   else{this.available=release.version;this.message="A new app version is available.";}
  }catch{this.message=this.available?"A new version is ready. Internet access is required to update.":"The version cannot be checked now. Try again when internet access is available.";}
  finally{this.checking=false;this.changed();}
  if(automatic&&this.available&&verified)this.apply({automatic:true});
 }
 apply({automatic=false}={}){
  if(!this.available||!this.visible())return false;
  const reason=this.block({automatic});
  if(reason){this.message="A new version is ready. "+reason;this.changed();return false;}
  let attempted=this.lastReload===this.available;try{attempted||=this.storage?.getItem(ATTEMPT_KEY)===this.available;}catch{}
  if(automatic&&attempted){this.message="Select “Update app” to open the new version.";this.changed();return false;}
  this.lastReload=this.available;try{this.storage?.setItem(ATTEMPT_KEY,this.available);}catch{}
  this.message="Opening the new version …";this.changed();this.reload(this.available);return true;
 }
}

export function watchAppUpdates(updates,{page=window,doc=document,schedule=setInterval,cancel=clearInterval}={}){
 const resume=()=>{if(!doc.hidden)void updates.check({automatic:true});};
 const visibility=()=>{if(!doc.hidden)resume();};
 page.addEventListener('pageshow',resume);page.addEventListener('online',resume);doc.addEventListener('visibilitychange',visibility);
 const timer=schedule(()=>{if(!doc.hidden)void updates.check();},300000);
 resume();
 return ()=>{page.removeEventListener('pageshow',resume);page.removeEventListener('online',resume);doc.removeEventListener('visibilitychange',visibility);cancel(timer);};
}
