/* Browser-side PDF + image OCR, no file uploads.
   pdfjs-dist 4.10.38; tesseract.js 5.1.1; packaged locally. */
import { previewImport, normalizeTerm, validTerm } from './engine.mjs';
const root = new URL('../', import.meta.url);
let pdfjsPromise = null;
let tesseractPromise = null;
let ocrWorkerPromise = null;
const MAX_DOCUMENT_BYTES = 22_000_000;
const MAX_PAGES = 25;
const MIN_SCAN_TEXT = 18;

export function importKind(file) {
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  if (['txt', 'csv', 'tsv'].includes(ext) || String(file?.type || '').startsWith('text/')) return 'text';
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (['png','jpg','jpeg','webp','bmp'].includes(ext) || String(file?.type || '').startsWith('image/')) return 'image';
  return 'unsupported';
}
export function validateImportFile(file) {
  if (!file || !Number.isFinite(file.size)) throw new Error('请先选择文件');
  if (file.size <= 0) throw new Error('文件是空的');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文件太大。单次最多支持 22MB，请拆分为小文件');
  const kind = importKind(file);
  if (kind === 'unsupported') throw new Error('不支持此文件格式，请选择 PDF、照片、TXT、CSV 或 TSV');
  return kind;
}
async function getPDF() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf/pdf.min.mjs').then(m=>{
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}
async function getTesseract() {
  if (!tesseractPromise) tesseractPromise = new Promise((resolve,reject)=>{
    if (globalThis.Tesseract) return resolve(globalThis.Tesseract);
    const script = document.createElement('script');
    script.src = new URL('../vendor/tesseract/tesseract.min.js', import.meta.url).href;
    script.onload=()=>globalThis.Tesseract?resolve(globalThis.Tesseract):reject(new Error('OCR 引擎没有初始化'));
    script.onerror=()=>reject(new Error('无法载入本机 OCR 引擎'));
    document.head.appendChild(script);
  });
  return tesseractPromise;
}
async function getOCRWorker(onProgress = () => {}) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async()=>{
      const Tesseract = await getTesseract();
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: new URL('../vendor/tesseract/worker.min.js', import.meta.url).href,
        corePath: new URL('../vendor/tesseract/core/', import.meta.url).href,
        langPath: new URL('../vendor/tesseract/lang', import.meta.url).href,
        logger: info => {
          if (info && typeof info.status === 'string') onProgress(info.status,info.progress || 0);
        }
      });
      // English vocabulary + common punctuation
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'- ;.,:0123456789\n"
      });
      return worker;
    })().catch(error=>{ocrWorkerPromise=null;throw error;});
  }
  return ocrWorkerPromise;
}
async function imageToCanvas(imageFile) {
  const blob= imageFile instanceof Blob ? imageFile : new Blob([imageFile]);
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    image.decoding='async';
    const decoded=new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error('无法解码图片，请尝试 JPG 或 PNG'));
    });
    image.src=url;await decoded;
    const naturalWidth=image.naturalWidth || image.width;
    const naturalHeight=image.naturalHeight || image.height;
    const scale=Math.min(1,2200/Math.max(naturalWidth,naturalHeight),Math.sqrt(2_700_000/(naturalWidth*naturalHeight)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(naturalHeight*scale));
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if (!context) throw new Error('浏览器图像处理不可用');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas;
  } finally {URL.revokeObjectURL(url);}
}
export async function recognizeImage(file, onProgress=()=>{}) {
  validateImportFile(file);
  onProgress('正在准备照片',0.05);
  const canvas=await imageToCanvas(file);
  try {
    const worker=await getOCRWorker(onProgress);
    onProgress('正在识别英文单词',0.55);
    const {data}=await worker.recognize(canvas);
    return String(data?.text || '');
  } finally {canvas.width=0;canvas.height=0;}
}
export async function extractPDF(file, {onProgress=()=>{}, scanImages=false} = {}) {
  validateImportFile(file);
  const pdfjs=await getPDF();
  const document=await pdfjs.getDocument({
    data:new Uint8Array(await file.arrayBuffer()),
    useSystemFonts:true,
    disableFontFace:false,
    isEvalSupported:false
  }).promise;
  const total=Math.min(document.numPages,MAX_PAGES);
  const parts=[];
  try {
    for (let index=1;index<=total;index++) {
      onProgress('正在读取 PDF 第 '+index+' / '+total+' 页',index/total);
      const page=await document.getPage(index);
      const content=await page.getTextContent();
      let text='';
      let previousY=null;
      for(const item of content.items) {
        if(typeof item.str !== 'string') continue;
        const y=Array.isArray(item.transform)?item.transform[5]:null;
        if (text && y!==null && previousY!==null && Math.abs(y-previousY)>4) text+='\n';
        else if(text && !text.endsWith('\n')) text+=' ';
        text+=item.str;
        previousY=y;
      }
      if (scanImages && text.replace(/\s/g,'').length<MIN_SCAN_TEXT) {
        const viewport=page.getViewport({scale:1.6});
        const scale=Math.min(1,Math.sqrt(2_500_000/(viewport.width*viewport.height)));
        const renderViewport=page.getViewport({scale:1.6*scale});
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(renderViewport.width);
        canvas.height=Math.ceil(renderViewport.height);
        const ctx=canvas.getContext('2d');
        if(!ctx)throw new Error('无法渲染 PDF 扫描页');
        await page.render({canvasContext:ctx,viewport:renderViewport}).promise;
        try {
          const ocr=await getOCRWorker(onProgress);
          const res=await ocr.recognize(canvas);
          text=String(res?.data?.text||'');
        }finally{canvas.width=0;canvas.height=0;}
      }
      parts.push(text);
      page.cleanup();
    }
  }finally{await document.destroy();}
  return {text:parts.join('\n'),pages:total,truncated:document.numPages>MAX_PAGES};
}
export async function extractImportFile(file,{onProgress=()=>{},scanImages=true}={}) {
  const kind=validateImportFile(file);
  if(kind==='text') return {kind,text:await file.text(),pages:0,truncated:false};
  if(kind==='pdf') return {kind,...await extractPDF(file,{onProgress,scanImages})};
  return {kind,text:await recognizeImage(file,onProgress),pages:1,truncated:false};
}
/** Parses a copied wordlist or scanned text.
    Known words can be resolved from bundled lexicons; unknown words remain ambiguous, not invented. */
export function resolveDocumentWords(text, lexicon, {includeAllKnown=false,limit=1200}={}) {
  const baseline=previewImport(text,lexicon);
  const result=[...baseline.words];
  const seen=new Set(result.map(w=>w.id));
  const unknown=[];
  const max=Math.min(1500,Math.max(1,limit));
  const lines=String(text||'').split(/\r?\n/);
  for(const line of lines.slice(0,1800)) {
    if(result.length>=max)break;
    if (/^\s*[\d\W]*$/.test(line))continue;
    // For lists, a single term per line or a term followed by optional symbols.
    const normalized=line.trim();
    if(validTerm(normalized)){
      const id=normalizeTerm(normalized);
      if(lexicon.has(id)&&!seen.has(id)){result.push({...lexicon.get(id)});seen.add(id);}
      else if(!lexicon.has(id)&&unknown.length<60)unknown.push(normalized);
    }
    if(includeAllKnown) {
      // Article import is opt-in to avoid accidentally importing thousands of incidental words.
      for(const match of line.matchAll(/\b[A-Za-z][A-Za-z'’-]{1,44}\b/g)){
        const id=normalizeTerm(match[0]);
        if(!seen.has(id)&&lexicon.has(id)){seen.add(id);result.push({...lexicon.get(id)});}
        if(result.length>=max)break;
      }
    }
  }
  return {
    words:result.slice(0,max),
    ambiguous:[...new Set([...baseline.ambiguous.slice(0,70),...unknown])].slice(0,100),
    ignored:Math.max(0,lines.length-1800)
  };
}
