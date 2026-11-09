import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {domain,productionEnv,productionContext,validateProduction} from './production.mjs';
import {root,context,checkConfig} from './infra.mjs';
const template=readFileSync(resolve(root,'.env.example'),'utf8');
const environment=()=>productionEnv(template,'learn.example.com','files.example.com','ops@example.com');
const cache=resolve(root,'.task-cache/tencent-deploy');mkdirSync(cache,{recursive:true});
function withEnvironment(run) {
  const file=resolve(cache,'production-'+randomUUID()+'.env');
  writeFileSync(file,environment().replace(/^SMTP_HOST=.*$/m,'SMTP_HOST=smtp.example.com'),{mode:0o600});
  try{return run(file);}finally{unlinkSync(file);}
}
test('hostnames reject URLs, interpolation and aliased storage hosts',()=>{
  for(const value of ['https://learn.example.com','localhost','127.0.0.1','learn.example.com:443','bad\nSMTP_HOST=x','{env.SECRET}','-bad.example.com'])assert.throws(()=>domain(value));
  assert.throws(()=>productionEnv(template,'learn.example.com','learn.example.com','ops@example.com'));
  assert.throws(()=>productionEnv(template,'learn.example.com','files.example.com','ops@example.com\nBAD=x'));
});
test('production initialization generates independent secrets and refuses overwrite',()=>{
  const file=resolve(cache,'init-'+randomUUID()+'.env');
  const args=['--',resolve(root,'scripts/production.mjs'),'init','--env-file',file,'--domain','learn.example.com','--storage-domain','files.example.com','--email','ops@example.com'];
  try {
    const first=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(first.status,0,first.stderr);
    const before=readFileSync(file,'utf8');assert.ok(!before.includes('__POSTGRES_PASSWORD__'));
    assert.notEqual(before,environment());assert.match(before,/^TEST_LOGIN_ENABLED=false$/m);assert.match(before,/^COOKIE_SECURE=true$/m);
    const second=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.notEqual(second.status,0);assert.equal(readFileSync(file,'utf8'),before);
    for(const key of ['POSTGRES_PASSWORD','SECRET_KEY','ENCRYPTION_KEY','STORAGE_SECRET_KEY']) {
      const secret=before.match(new RegExp('^'+key+'=(.+)$','m'))[1];assert.ok(!(first.stdout+first.stderr+second.stdout+second.stderr).includes(secret));
    }
  }finally{if(existsSync(file))unlinkSync(file);}
});
test('production merge removes service ports, preserves internal boundaries and disables test login',()=>withEnvironment(file=>{
  const base=context(file).config();checkConfig(base);
  const config=productionContext(file).config();validateProduction(config);
  for(const name of ['postgres','redis','storage','backend','worker','frontend'])assert.equal(config.services[name].image,base.services[name].image);
  for(const name of ['frontend','backend','storage'])assert.ok(base.services[name].ports.length,'Local service ports must remain available');
  assert.equal(config.services.frontend.environment.BACKEND_INTERNAL_URL,'http://backend:8000');
  assert.ok(Object.hasOwn(config.volumes,'caddy-data'));assert.ok(!Object.hasOwn(base.services,'proxy'));
  const publicBackend=structuredClone(config);publicBackend.services.backend.ports=[{published:'8000',target:8000}];assert.throws(()=>validateProduction(publicBackend));
  const shortcut=structuredClone(config);shortcut.services.frontend.build.args.NEXT_PUBLIC_TEST_LOGIN_ENABLED='true';assert.throws(()=>validateProduction(shortcut));
  const mail=structuredClone(config);mail.services.backend.environment.SMTP_HOST='';assert.throws(()=>validateProduction(mail));
}));
test('existing Nginx mode exposes only loopback app and storage ports and omits Caddy',()=>withEnvironment(file=>{
  writeFileSync(file,readFileSync(file,'utf8')+'\nFRONTEND_IMAGE=webapp-frontend:verified\nBACKEND_IMAGE=webapp-backend:verified\n'+
    ['POSTGRES','REDIS','STORAGE'].map((name,index)=>name+'_IMAGE=sha256:'+String(index+1).repeat(64)).join('\n')+'\n');
  const config=productionContext(file,{ingress:'nginx'}).config();validateProduction(config,{ingress:'nginx'});
  assert.equal(config.services.frontend.ports[0].published,'13100');assert.equal(config.services.storage.ports[0].published,'13900');
  const openStorage=structuredClone(config);openStorage.services.storage.ports[0].host_ip='0.0.0.0';
  assert.throws(()=>validateProduction(openStorage,{ingress:'nginx'}));
  writeFileSync(file,readFileSync(file,'utf8')+'STORAGE_DOWNLOAD_ORIGIN=https://files.example.com\n');
  assert.throws(()=>validateProduction(productionContext(file,{ingress:'nginx'}).config(),{ingress:'nginx'}));
  writeFileSync(file,readFileSync(file,'utf8')+'STORAGE_DOWNLOAD_ORIGIN=https://learn.example.com\n');
  const sameOrigin=productionContext(file,{ingress:'nginx'}).config();
  validateProduction(sameOrigin,{ingress:'nginx'});
  assert.equal(sameOrigin.services.backend.environment.STORAGE_PUBLIC_ENDPOINT,'https://learn.example.com');
}));

test('public test login requires explicit authorization and matching secure frontend/backend gates',()=>withEnvironment(file=>{
  const config=productionContext(file).config();
  for(const name of ['backend','worker']) {
    config.services[name].environment.TEST_LOGIN_ENABLED='true';
    config.services[name].environment.TEST_LOGIN_PUBLIC_ORIGIN='https://learn.example.com';
  }
  config.services.frontend.build.args.NEXT_PUBLIC_TEST_LOGIN_ENABLED='true';
  assert.throws(()=>validateProduction(config));
  assert.equal(validateProduction(config,{allowPublicTestLogin:true}).testLogin,true);
  for(const name of ['backend','worker']) {
    const wrong=structuredClone(config);wrong.services[name].environment.TEST_LOGIN_PUBLIC_ORIGIN='https://other.example.com';
    assert.throws(()=>validateProduction(wrong,{allowPublicTestLogin:true}));
    const insecure=structuredClone(config);insecure.services[name].environment.COOKIE_SECURE='false';
    assert.throws(()=>validateProduction(insecure,{allowPublicTestLogin:true}));
  }
  const hidden=structuredClone(config);hidden.services.frontend.build.args.NEXT_PUBLIC_TEST_LOGIN_ENABLED='false';
  assert.throws(()=>validateProduction(hidden,{allowPublicTestLogin:true}));
}));
