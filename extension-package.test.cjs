const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,ext=path.join(root,'chrome-extension');
const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
const script=fs.readFileSync(path.join(ext,'content.js'),'utf8');
test('独立扩展仅在指定直播页注入，不申请额外浏览器权限',()=>{
  assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,'2.2.0');
  assert.equal(manifest.permissions,undefined);assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.background,undefined);assert.equal(manifest.externally_connectable,undefined);
  assert.deepEqual(manifest.content_scripts,[{matches:['https://eos.douyin.com/livesite/live/current*'],js:['content.js'],run_at:'document_idle',all_frames:false,world:'ISOLATED'}]);
});
test('扩展代码与已测脚本主体一致，无发券及远程执行代码',()=>{
  const userscript=fs.readFileSync(path.join(root,'douyin-live-auto.user.js'),'utf8');
  const body=userscript.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');
  assert.equal(script,'// Generated from douyin-live-auto.user.js v2.2.\n'+body);
  assert.doesNotMatch(script,/coupon|发券|优惠券|\beval\s*\(|new Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie/i);
});
test('工具栏页面不含内联脚本，只链接实际中控台',()=>{
  const html=fs.readFileSync(path.join(ext,manifest.action.default_popup),'utf8');
  assert.doesNotMatch(html,/<script|\bonclick\s*=|javascript:/i);
  assert.match(html,/https:\/\/eos\.douyin\.com\/livesite\/live\/current/);
  assert.ok(fs.existsSync(path.join(ext,'popup.css')));
});
test('所有图标均为正确尺寸的PNG，扩展清单引用文件完整',()=>{
  for(const [size,name] of Object.entries(manifest.icons)){
    const png=fs.readFileSync(path.join(ext,name));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),Number(size));assert.equal(png.readUInt32BE(20),Number(size));
  }
  assert.ok(fs.existsSync(path.join(ext,'content.js')));assert.ok(fs.existsSync(path.join(ext,'LICENSE')));
});
