import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const recipe = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(recipe);
const target = process.argv[2];
if (!target || !path.isAbsolute(target) || path.resolve(target) === repo) throw Error('Provide a separate absolute Site checkout path');
if (fs.existsSync(path.join(target,'.env'))) throw Error('Unexpected environment file in export destination');
const identity = JSON.parse(fs.readFileSync(path.join(recipe,'.openai/hosting.json'),'utf8')).project_id;
const existingManifest = path.join(target,'.openai/hosting.json');
if (fs.existsSync(existingManifest) && JSON.parse(fs.readFileSync(existingManifest,'utf8')).project_id !== identity) throw Error('Destination belongs to a different Site');
if (fs.existsSync(path.join(target,'.git')) && !fs.existsSync(existingManifest)) throw Error('Destination is an unrelated repository');
fs.mkdirSync(path.join(target,'src/product/components'),{recursive:true});
fs.mkdirSync(path.join(target,'src/product/lib'),{recursive:true});
fs.mkdirSync(path.join(target,'.openai'),{recursive:true});
const sourceFiles = [
  'components/workspace.tsx','components/course-space.tsx','components/course-editor.tsx','components/course-files.tsx',
  'components/profile.tsx','components/toast.tsx','components/icon.tsx','lib/course-types.ts','lib/learning-goals.ts',
];
const hashes = {};
function write(relative, text) { fs.writeFileSync(path.join(target,relative),text); }
function replaceOnce(text, before, after) { if(text.split(before).length !== 2) throw Error('Product source contract changed: '+before); return text.replace(before,after); }
for (const relative of sourceFiles) {
  const bytes = fs.readFileSync(path.join(repo,'frontend',relative));
  hashes[relative] = createHash('sha256').update(bytes).digest('hex');
  let text = bytes.toString('utf8').replace(/^'use client';\r?\n/, '');
  if (relative === 'components/course-space.tsx') text = replaceOnce(text, 'window.location.assign(result.url);', "const link = document.createElement('a'); link.href = result.url; link.download = file.filename; link.click();");
  if (relative === 'components/profile.tsx') text = replaceOnce(text, "<button className=\"button\" onClick={() => openEditor('password')}>修改密码</button>", '<button className="button" disabled>修改密码<span className="action-state">未开放</span></button>');
  write('src/product/'+relative,text);
}
write('src/product/globals.css',fs.readFileSync(path.join(repo,'frontend/app/globals.css')));
write('src/product/lib/api.ts',fs.readFileSync(path.join(recipe,'adapter.ts')));
write('src/product/components/account.tsx',fs.readFileSync(path.join(recipe,'account.tsx'),'utf8').replace("'./product/lib/api'","'../lib/api'"));
write('src/product/components/ai-settings.tsx',fs.readFileSync(path.join(recipe,'ai-settings.tsx')));
for (const file of ['main.tsx','demo.css']) write('src/'+file,fs.readFileSync(path.join(recipe,file)));
write('src/link.tsx', `import type {AnchorHTMLAttributes} from 'react';\nexport default function Link({href,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...props} href={href === '/system' ? '/#system' : href === '/' ? '/#' : href}/>;}\n`);
write('.openai/hosting.json',fs.readFileSync(path.join(recipe,'.openai/hosting.json')));
write('agent.md',fs.readFileSync(path.join(repo,'agent.md')));
write('.gitignore','node_modules/\ndist/\n.sites-runtime/\n*.tsbuildinfo\n.env*\n');
write('package.json',JSON.stringify({name:'learning-workbench-public',private:true,type:'module',engines:{node:'24.x'},scripts:{dev:'vite --host 127.0.0.1',check:'tsc --noEmit',build:'vite build'},dependencies:{react:'19.3.1','react-dom':'19.3.1'},devDependencies:{vite:'8.3.6',typescript:'5.9.3','@types/react':'19.3.0','@types/react-dom':'19.3.0','@types/node':'24.19.2'}},null,2)+'\n');
write('vite.config.ts',`import {defineConfig} from 'vite';\nimport {fileURLToPath,URL} from 'node:url';\nexport default defineConfig({resolve:{alias:{'next/link':fileURLToPath(new URL('./src/link.tsx',import.meta.url))}},build:{outDir:'dist'}});\n`);
write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',lib:['DOM','DOM.Iterable','ES2022'],module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,noEmit:true,skipLibCheck:true,types:['vite/client'],baseUrl:'.',paths:{'next/link':['src/link.tsx']}},include:['src','vite.config.ts']},null,2)+'\n');
write('index.html','<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="description" content="学习工作台公开体验版。创建课程、整理资料；数据仅保存在你的浏览器。"/><meta name="color-scheme" content="light dark"/><title>学习工作台 · 公开体验版</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n');
write('SOURCE.json',JSON.stringify({repository:'https://github.com/NuxusAurora/WebApp',product_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),source_hashes:hashes,notes:'Explicit public demo: browser-only adapter, local login, disabled password, blob download. No backend, env, credentials or user data exported.'},null,2)+'\n');
write('README.md','# 学习工作台公开体验版\n\n访客数据仅保存在浏览器。使用固定示例，不连接正式服务。\n\n构建：npm install、npm run check、npm run build。托管目录 dist。源版本与导出差异见 SOURCE.json。\n');
console.log('Exported isolated public Site to',target);
