// All entry points use Google Identity Services. Old redirect URLs are cleaned
// without invoking the retired gapi/Firebase iframe sign-in path.
export function consumeSignInIntent(href){
 const url=new URL(href),requested=url.searchParams.get('signin')==='google';
 if(requested)url.searchParams.delete('signin');
 return {requested,cleanUrl:url.href};
}
export async function choosePersistence(set,choices){
 for(const [name,value] of choices)try{await set(value);return name;}catch{}
 throw Object.assign(Error("Sign-in cannot be saved in this browser."),{code:'auth/web-storage-unsupported'});
}
// Keep only a known step and a known failed script host. Never display OAuth
// URLs, tokens, account details or arbitrary SDK/customData messages.
const steps={setup:"preparing sign-in",storage:"saving sign-in",popup:"opening the sign-in window",start:"starting sign-in",result:"returning from Google",credential:"confirming Google sign-in"};
export async function authStep(step,operation){
 try{return await operation();}catch(cause){
  const error=new Error('Sign-in failed',{cause});
  error.code=cause?.code;error.authStep=step;
  const target=cause?.customData?.target;
  if(target?.tagName==='SCRIPT')try{
   const host=new URL(target.src).hostname;
   if(['apis.google.com','accounts.google.com','www.gstatic.com'].includes(host))error.failedScriptHost=host;
  }catch{}
  throw error;
 }
}
export function authErrorMessage(error){
 const messages={
  'auth/popup-closed-by-user':"Sign-in cancelled. Press the Google sign-in button to try again.",
  'auth/cancelled-popup-request':"The sign-in window is already open. Complete sign-in there.",
  'auth/popup-blocked':"The browser blocked the sign-in window. Open the app in a regular Safari tab and try again.",
  'auth/web-storage-unsupported':"The browser will not save your sign-in. Try a regular Safari tab.",
  'auth/network-request-failed':"Google is unreachable. Check your internet connection and any sign-in blocking in your browser.",
  'auth/internal-error':"An internal error occurred during sign-in. Select “Reopen sign-in”.",
  'app/google-script-unavailable':"The Google sign-in button could not load from accounts.google.com. Try mobile data; if it still fails, report this code.",
  'app/google-client-missing':"The Google sign-in button is not configured correctly yet.",
  'app/google-credential-missing':"Google did not return a sign-in credential. Press the Google button again.",
  'auth/unauthorized-domain':"This domain is not authorised for sign-in. Open your configured app address and try again.",
  'auth/operation-not-allowed':"Google sign-in is not enabled for this project.",
  'app/invalid-auth-domain':"The sign-in domain is not configured correctly. Refresh the app."
 };
 const code=typeof error?.code==='string'&&/^(auth|app)\/[a-z-]+$/.test(error.code)?error.code:null;
 const message=code==='auth/network-request-failed'&&error?.authStep==='credential'
  ?"Google returned a sign-in credential, but the connection to Firebase failed. Check your internet connection and try again."
  :error?.failedScriptHost&&['apis.google.com','accounts.google.com','www.gstatic.com'].includes(error.failedScriptHost)
  ?`The browser could not load the sign-in script from ${error.failedScriptHost}. Select “Reopen sign-in”.`
  :messages[code]||"Sign-in failed. Select “Reopen sign-in”.";
 return `${message}${code?" Code: "+code+'.':''}${steps[error?.authStep]?" Step: "+steps[error.authStep]+'.':''} Sign-in P5.`;
}
