/* Optional cloud AI: user-supplied key kept ONLY in JS memory.
   Browser CORS restrictions apply. Never place developer secrets in a static PWA. */
export const AI_PROVIDERS = Object.freeze({
  qwen: {label:'通义千问',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
  deepseek:{label:'DeepSeek',baseURL:'https://api.deepseek.com',model:'deepseek-chat'},
  openai:{label:'OpenAI',baseURL:'https://api.openai.com/v1',model:'gpt-4o-mini'},
  custom:{label:'自定义兼容接口',baseURL:'https://',model:''}
});
const SYSTEM_PROMPT = '你是大学英语四、六级词汇学习助手。按词性解释常见义项，提供简洁、自然的英文例句、同义词和近义词辨析。严禁编造历年真题出处。用中文精炼回答，若不确定请指出。';
export function getAIConfig(provider='qwen', custom={}) {
  const preset=AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
  return {provider,baseURL:custom.baseURL || preset.baseURL,model:custom.model || preset.model};
}
export function makeAIEndpoint(baseURL) {
  const value=String(baseURL||'').trim();
  let url;
  try{url=new URL(value);}catch{throw new Error('请输入完整的 HTTPS 接口地址');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash)
    throw new Error('必须使用不包含用户名、密码和参数的 HTTPS 接口地址');
  const path=url.pathname.replace(/\/+$/,'');
  url.pathname=path.endsWith('/chat/completions')?path:path+'/chat/completions';
  return url.href;
}
export async function askCloudAI({baseURL,model,key,question,signal}) {
  const endpoint=makeAIEndpoint(baseURL);
  if(!String(model||'').trim()) throw new Error('请填写模型名称');
  if(!String(key||'').trim()) throw new Error('请填写你自己的 API Key（不会保存到本地备份）');
  if(!String(question||'').trim()) throw new Error('请输入要解析的单词或问题');
  let response;
  try {
    response=await fetch(endpoint,{
      method:'POST',mode:'cors',signal,
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+key.trim()},
      body:JSON.stringify({
        model:model.trim(),temperature:0.2,max_tokens:450,
        messages:[
          {role:'system',content:SYSTEM_PROMPT},
          {role:'user',content:String(question).slice(0,1500)}
        ]
      })
    });
  }catch(error){
    if(error?.name==='AbortError') throw new Error('请求已取消或超时');
    throw new Error('无法连接 API。请检查网络、地址，或服务商是否允许浏览器跨域调用（CORS）。为公开用户使用，通常需要自己的后端代理。');
  }
  if(!response.ok)throw new Error('AI 服务返回 HTTP '+response.status+'，请检查模型、额度和密钥权限');
  let payload;
  try { payload=await response.json(); } catch {throw new Error('AI 服务返回的内容不是 JSON');}
  const message=payload?.choices?.[0]?.message?.content;
  if(typeof message!=='string'||!message.trim())throw new Error('AI 未返回可用的文字答案');
  return message.trim().slice(0,15000);
}
