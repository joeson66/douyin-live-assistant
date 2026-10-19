const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const source=fs.readFileSync(path.join(root,'douyin-live-auto.user.js'),'utf8');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='.git'?[]:e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('运行源码不包含发券、远程执行、凭据读取或网络上传模块',()=>{
 assert.doesNotMatch(source,/coupon|优惠券|发券|\beval\s*\(|new Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie/i);
 assert.match(source,/products:\s*\[\]/);assert.match(source,/comments:\s*\[\]/);
 assert.match(source,/@namespace\s+douyin-live-assistant/);
 assert.match(source,/__douyin_live_auto_cfg_v2/);
});
test('公开文件无个人绝对路径、凭据文件、录制或历史安装包',()=>{
 for(const f of files(root)){
  const relative=path.relative(root,f);
  assert.doesNotMatch(relative,/(?:^|\/)(?:\.env(?:\..*)?|\.DS_Store|node_modules|release|screenshots|mac-offline-install)(?:\/|$)|\.(?:zip|crx|pem|jpg|jpeg|mp4|mov|backup\.\w+)$/i);
  if(!f.endsWith('.png')){
   const s=fs.readFileSync(f,'utf8');
   assert.doesNotMatch(s,/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//);
   assert.doesNotMatch(s,/(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  }
 }
});
test('合成测试ID使用独立虚拟范围，运行源码没有硬编码业务ID',()=>{
 assert.equal((source.match(/(?<!\d)\d{16,19}(?!\d)/g)||[]).length,0);
 const fixture=fs.readFileSync(path.join(root,'test.cjs'),'utf8');
 for(const id of fixture.match(/(?<!\d)\d{16,19}(?!\d)/g)||[]) assert.match(id,/^100000000000\d{4}$/);
});
