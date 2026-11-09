import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {docker,generatedEnv,root} from './infra.mjs';

export function domain(value) {
  assert.ok(typeof value === 'string' && value.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value),
  'Use a lowercase DNS hostname without a scheme, path or port');
  assert.ok(!value.endsWith('.localhost') && !value.endsWith('.local'), 'Use a public DNS hostname');
  return value;
}

export function productionEnv(template, app, storage, email) {
  domain(app);domain(storage);assert.notEqual(app,storage,'App and downloads need distinct hostnames');
  assert.match(email,/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/,'Set a plain ACME contact email');
  let env=generatedEnv(template);
  const settings={COMPOSE_PROJECT_NAME:'learning-production',COOKIE_SECURE:'true',TEST_LOGIN_ENABLED:'false',
    PUBLIC_ORIGIN:'https://'+app,STORAGE_PUBLIC_ENDPOINT:'https://'+storage,STORAGE_BUCKET:'learning',
    MAIL_FROM:email};
  for(const [key,value] of Object.entries(settings))env=env.replace(new RegExp('^'+key+'=.*$','m'),key+'='+value);
  return env+'\nAPP_DOMAIN='+app+'\nSTORAGE_DOMAIN='+storage+'\nACME_EMAIL='+email+
    '\nAI_ALLOWED_ORIGINS=https://api.nuxusaurora.com\n';
}

export function productionContext(envFile,{ingress='caddy'}={}) {
  assert.ok(['caddy','nginx'].includes(ingress),'Use caddy or nginx ingress');
  const args=['compose','--env-file',resolve(envFile),'-f',resolve(root,'compose.yaml'),'-f',resolve(root,'deploy/compose.production.yaml')];
  if(ingress==='nginx')args.push('-f',resolve(root,'deploy/compose.nginx.yaml'));
  const compose=(...tail)=>docker([...args,...tail]);
  return {compose,config:()=>JSON.parse(compose('--profile','app','config','--format','json'))};
}

export function validateProduction(config,{requireMail=true,ingress='caddy'}={}) {
  const services=config.services;
  for(const name of ['postgres','redis','storage','backend','worker','frontend'])assert.ok(services[name],'Missing '+name);
  const app=domain(new URL(services.backend.environment.PUBLIC_ORIGIN).hostname);
  const storage=domain(new URL(services.backend.environment.STORAGE_PUBLIC_ENDPOINT).hostname);
  assert.notEqual(app,storage);
  for(const [name,service] of Object.entries(services)) {
    if(ingress==='nginx'&&['frontend','storage'].includes(name)) {
      assert.equal(service.ports?.length,1);
      assert.equal(service.ports[0].host_ip,'127.0.0.1','Host Nginx ports must be loopback-only');continue;
    }
    if(name!=='proxy')assert.ok(!service.ports?.length,'Only the HTTPS proxy may publish ports');
  }
  if(ingress==='nginx')assert.ok(!services.proxy,'Host Nginx mode must not start Caddy');
  else {
    assert.ok(services.proxy,'Missing proxy');
    assert.equal(services.proxy.environment.APP_DOMAIN,app);assert.equal(services.proxy.environment.STORAGE_DOMAIN,storage);
    assert.deepEqual(services.proxy.ports.map(p=>p.published+'/'+p.protocol).sort(),['443/tcp','443/udp','80/tcp']);
    assert.ok(!('data' in services.proxy.networks),'Proxy must not join the database network');
  }
  for(const name of ['postgres','redis']) {
    assert.ok(Object.keys(services[name].networks).every(n=>config.networks[n].internal),'Database/cache networks must be internal');
  }
  for(const name of ['backend','worker']) {
    const env=services[name].environment;
    assert.equal(env.COOKIE_SECURE,'true');assert.equal(env.TEST_LOGIN_ENABLED,'false');
    assert.equal(env.PUBLIC_ORIGIN,'https://'+app);assert.equal(env.STORAGE_PUBLIC_ENDPOINT,'https://'+storage);
    assert.equal(env.STORAGE_ENDPOINT,'http://storage:9000');
    if(requireMail){assert.ok(env.SMTP_HOST,'Configure SMTP_HOST before public registration');assert.ok(env.MAIL_FROM && !env.MAIL_FROM.endsWith('@localhost'),'Configure MAIL_FROM');}
  }
  assert.equal(services.frontend.build.args.NEXT_PUBLIC_TEST_LOGIN_ENABLED,'false');
  return {app,storage};
}

async function main() {
  const [command,...flags]=process.argv.slice(2);const values={};
  for(let i=0;i<flags.length;i+=2){assert.ok(flags[i].startsWith('--')&&flags[i+1],'Flags need values');assert.ok(!Object.hasOwn(values,flags[i]),'Duplicate flag');values[flags[i]]=flags[i+1];}
  const allowed=command==='init'?['--env-file','--domain','--storage-domain','--email']:['--env-file','--ingress','--allow-missing-mail','--no-build'];
  assert.ok(Object.keys(values).every(k=>allowed.includes(k)),'Unsupported flag');
  const envFile=resolve(values['--env-file']??resolve(root,'.env.production'));
  if(command==='init') {
    const env=productionEnv(readFileSync(resolve(root,'.env.example'),'utf8'),values['--domain'],values['--storage-domain'],values['--email']);
    writeFileSync(envFile,env,{flag:'wx',mode:0o600});
    console.log('Created a new production environment. Configure SMTP before check/up. No existing file was replaced.');return;
  }
  assert.ok(['check','up','status'].includes(command),'Use init, check, up or status');
  const ingress=values['--ingress']??'caddy';
  const ctx=productionContext(envFile,{ingress});const config=ctx.config();
  const {app,storage}=validateProduction(config,{ingress,requireMail:command!=='status'&&values['--allow-missing-mail']!=='true'});
  if(command==='check'){console.log('PASS isolated production ports, TLS origins, secure cookies, disabled test login and SMTP configuration');return;}
  if(command==='status'){console.log(ctx.compose('--profile','app','ps'));return;}
  if(values['--no-build']!=='true')ctx.compose('--profile','app','build','backend','frontend');
  ctx.compose('up','-d','--wait','--wait-timeout','180','postgres','redis','storage');
  ctx.compose('--profile','app','run','--rm','--no-deps','backend','alembic','upgrade','head');
  ctx.compose('--profile','app','up','-d','--wait','--wait-timeout','180');
  console.log('Services started. Verify DNS/TLS, https://'+app+' and signed downloads at https://'+storage+'.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{
  // Do not forward Compose diagnostics, resolved environment or credentials.
  console.error('Production command failed. Check domains, SMTP, Docker/Compose and the production runbook; existing volumes were retained.');process.exitCode=1;
});
