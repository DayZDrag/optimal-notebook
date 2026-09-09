import { registerPlugin } from '@capacitor/core';
import { isNativeAndroid } from './native';

interface VoiceInputPlugin {
  available(): Promise<{available:boolean}>;
  start(options:{language:string}): Promise<{text:string;cancelled?:boolean}>;
}
interface SpeechAlternative { transcript: string }
interface SpeechResult { isFinal:boolean; [index:number]:SpeechAlternative }
interface SpeechResultList { length:number; [index:number]:SpeechResult }
interface SpeechEvent { results:SpeechResultList }
interface SpeechErrorEvent { error:string }
interface BrowserRecognition {
  lang:string; interimResults:boolean; continuous:boolean; maxAlternatives:number;
  onresult:((event:SpeechEvent)=>void)|null; onerror:((event:SpeechErrorEvent)=>void)|null; onend:(()=>void)|null;
  start():void;
}
interface BrowserRecognitionConstructor { new():BrowserRecognition }
declare global { interface Window { SpeechRecognition?:BrowserRecognitionConstructor; webkitSpeechRecognition?:BrowserRecognitionConstructor } }

const VoiceInput=registerPlugin<VoiceInputPlugin>('VoiceInput');
const browserRecognition=()=>window.SpeechRecognition ?? window.webkitSpeechRecognition;

export function appendVoiceText(draft:string,transcript:string) {
  const spoken=transcript.trim();
  if (!spoken) return draft;
  if (!draft) return spoken;
  return draft.endsWith('\n') ? draft+spoken : draft+'\n'+spoken;
}

export async function voiceInputAvailable() {
  if (isNativeAndroid()) {
    try { return (await VoiceInput.available()).available; } catch { return false; }
  }
  return !!browserRecognition();
}

function browserVoiceInput(language:string) {
  const Recognition=browserRecognition();
  if (!Recognition) return Promise.reject(new Error('Голосовой ввод не поддерживается этим браузером'));
  return new Promise<string>((resolve,reject)=>{
    const recognition=new Recognition(); let finished=false;
    const finish=(callback:()=>void)=>{if(finished)return;finished=true;callback();};
    recognition.lang=language;recognition.interimResults=false;recognition.continuous=false;recognition.maxAlternatives=1;
    recognition.onresult=event=>finish(()=>{
      const text=Array.from({length:event.results.length},(_,index)=>event.results[index][0]?.transcript ?? '').join(' ').trim();
      resolve(text);
    });
    recognition.onerror=event=>finish(()=>reject(new Error(event.error==='not-allowed'?'Разрешите доступ к микрофону для голосового ввода':`Не удалось распознать речь: ${event.error}`)));
    recognition.onend=()=>finish(()=>resolve(''));
    recognition.start();
  });
}

export async function dictate(language:string) {
  if (isNativeAndroid()) {
    const result=await VoiceInput.start({language});
    return result.cancelled ? '' : result.text.trim();
  }
  return browserVoiceInput(language);
}
