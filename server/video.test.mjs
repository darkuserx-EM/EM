import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateVideo} from './video-validation.mjs';
import {videoRange} from './video-range.mjs';
test('Video: valida contenido H.264/AAC y rechaza archivos dañados o códec incompatible',async()=>{
 const bytes=await fs.readFile(new URL('./fixtures/video-qa.mp4',import.meta.url));assert.equal(await validateVideo(bytes),true);
 await assert.rejects(validateVideo(bytes.subarray(0,bytes.length-20)));await assert.rejects(validateVideo(Buffer.alloc(26*1024*1024)));
 const wrong=Buffer.from(bytes),codec=wrong.indexOf(Buffer.from('avc1'),100);assert.ok(codec>0);wrong.write('hvc1',codec);await assert.rejects(validateVideo(wrong));
 const duration=Buffer.from(bytes),mvhd=duration.indexOf(Buffer.from('mvhd'));assert.ok(mvhd>0);duration.writeUInt32BE(61000,mvhd+20);await assert.rejects(validateVideo(duration));
});
test('Video: rangos abiertos, sufijos y límites; rechaza varios rangos y fuera del archivo',()=>{
 assert.equal(videoRange(undefined,100),null);assert.deepEqual(videoRange('bytes=0-9',100),{start:0,end:9});assert.deepEqual(videoRange('bytes=90-',100),{start:90,end:99});assert.deepEqual(videoRange('bytes=-10',100),{start:90,end:99});
 for(const value of ['bytes=-0','bytes=100-','bytes=9-2','bytes=0-1,4-5','items=1-2','bytes=-','bytes=999999999999999999999-'])assert.equal(videoRange(value,100),false,value);
});
