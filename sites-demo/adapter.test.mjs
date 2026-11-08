import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoApi,STORAGE_KEY} from './adapter.ts';
const memory = () => {const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const login = api => api('auth/test-login',{method:'POST'});
const courseInput = {title:'测试课程',subject:'数学',textbook:'示例教材',learning_goal:'多学一点'};
test('anonymous visitors and separate browsers have isolated sessions and data',async()=>{
  const a=createDemoApi(memory()),b=createDemoApi(memory());
  await assert.rejects(a('users/me'),error=>error.status===401);
  await login(a); await a('users/me',{method:'PATCH',body:JSON.stringify({display_name:'甲'})});
  await login(b); assert.equal((await b('users/me')).display_name,'学习体验者');
  assert.equal((await a('users/me')).display_name,'甲');
});
test('course CRUD persists across adapter instances and logout preserves work',async()=>{
  const storage=memory(); let api=createDemoApi(storage); await login(api);
  const course=await api('courses',{method:'POST',body:JSON.stringify(courseInput)});
  await api('courses/'+course.id,{method:'PATCH',body:JSON.stringify({status:'archived'})});
  api=createDemoApi(storage); assert.equal((await api('courses/'+course.id)).status,'archived');
  await api('auth/logout',{method:'POST'}); await assert.rejects(api('courses'),error=>error.status===401);
  await login(api); assert.equal((await api('courses/'+course.id)).title,courseInput.title);
  await api('courses/'+course.id,{method:'DELETE'}); await assert.rejects(api('courses/'+course.id),error=>error.status===404);
});
test('UTF-8 files persist, download through owned URLs and delete with course',async()=>{
  const storage=memory(); const released=[]; let blob;
  const api=createDemoApi(storage,{create:value=>{blob=value;return 'blob:demo';},release:url=>released.push(url)});
  await login(api); const course=(await api('courses'))[0]; const route='courses/'+course.id+'/uploads';
  const file=await api(route,{method:'POST',body:new Blob(['中文笔记']),headers:{'X-Filename':encodeURIComponent('笔记.txt')}});
  assert.equal(file.size,12); assert.equal((await api(route)).length,2);
  assert.deepEqual(await api(route+'/'+file.id+'/download'),{url:'blob:demo'});
  assert.equal(await blob.text(),'中文笔记'); assert.deepEqual(released,['blob:demo']);
  await api('courses/'+course.id,{method:'DELETE'});
  assert.ok(!JSON.parse(storage.getItem(STORAGE_KEY)).files.some(f=>f.courseId===course.id));
});
test('invalid files, foreign routes and aborted writes do not change data',async()=>{
  const storage=memory(),api=createDemoApi(storage); await login(api); const id=(await api('courses'))[0].id;
  const before=storage.getItem(STORAGE_KEY);
  await assert.rejects(api('courses/'+id+'/uploads',{method:'POST',body:new Blob([new Uint8Array([0xff])]),headers:{'X-Filename':'a.txt'}}),error=>error.status===422);
  await assert.rejects(api('https://external.invalid/courses'),error=>error.status===404);
  const controller=new AbortController();controller.abort();
  await assert.rejects(api('courses',{method:'POST',body:JSON.stringify(courseInput),signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(storage.getItem(STORAGE_KEY),before);
});
test('quota failure is explicit and leaves the last saved state unchanged',async()=>{
  const storage=memory(); await login(createDemoApi(storage)); const before=storage.getItem(STORAGE_KEY);
  const api=createDemoApi({...storage,setItem:()=>{throw Error('QuotaExceeded');}});
  await assert.rejects(api('courses',{method:'POST',body:JSON.stringify(courseInput)}),error=>error.status===507);
  assert.equal(storage.getItem(STORAGE_KEY),before);
});
test('corrupt local data is recoverable and real account operations are unavailable',async()=>{
  const storage=memory();storage.setItem(STORAGE_KEY,'{"version":1,"signedIn":true}');
  await assert.rejects(createDemoApi(storage)('users/me'),error=>error.status===503 && error.message.includes('重置体验'));
  const api=createDemoApi(memory());await login(api);
  await assert.rejects(api('auth/register',{method:'POST'}),error=>error.status===422);
  await assert.rejects(api('auth/change-password',{method:'POST'}),error=>error.status===422);
});
