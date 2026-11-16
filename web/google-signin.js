// Google Identity Services returns a Google ID token directly to Firebase.
// No gapi script, Firebase auth iframe, token URL or custom backend is used.
const SCRIPT="https://accounts.google.com/gsi/client?hl=en";
let loading;
export function loadGoogleIdentity({document=window.document,getGoogle=()=>window.google,timeoutMs=20000}={}){
 if(getGoogle()?.accounts?.id)return Promise.resolve(getGoogle().accounts.id);
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let timer;
  const fail=()=>{clearTimeout(timer);script.remove();reject(Object.assign(Error('Google Identity unavailable'),{code:'app/google-script-unavailable'}));};
  script.src=SCRIPT;script.referrerPolicy='strict-origin';script.async=true;script.defer=true;
  script.onload=()=>{clearTimeout(timer);const identity=getGoogle()?.accounts?.id;identity?resolve(identity):fail();};
  script.onerror=fail;timer=setTimeout(fail,timeoutMs);document.head.appendChild(script);
 }).catch(error=>{loading=null;throw error;});
 return loading;
}
export function credentialReceiver(exchange,{busy=()=>{},error=()=>{}}={}){
 let pending=false;
 return async response=>{
  if(pending)return;
  if(typeof response?.credential!=='string'||!response.credential||response.credential.length>20000){error(Object.assign(Error('Missing credential'),{code:'app/google-credential-missing'}));return;}
  pending=true;busy(true);
  try{await exchange(response.credential);}catch(cause){error(cause);}finally{pending=false;busy(false);}
 };
}
export async function mountGoogleSignIn(element,config,exchange,callbacks={},load=loadGoogleIdentity){
 if(!config?.projectId||!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.googleClientId||''))throw Object.assign(Error('Missing Google web client'),{code:'app/google-client-missing'});
 const identity=await load();
 identity.initialize({client_id:config.googleClientId,callback:credentialReceiver(exchange,callbacks),auto_select:false,ux_mode:'popup'});
 identity.renderButton(element,{type:'standard',theme:'outline',size:'large',shape:'pill',text:'signin_with',locale:"en",width:Math.min(360,Math.max(200,Math.floor(element.clientWidth)))});
}
