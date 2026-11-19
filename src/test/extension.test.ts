import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  AUTH_TYPES,
  UPLOAD_CHANNELS,
  UPLOAD_NAME_TYPES,
  normalize,
} from '../config';

suite('config.normalize', () => {
  test('serverUrl 去尾斜杠（含多个）', () => {
    assert.strictEqual(
      normalize({ serverUrl: ' https://x//' }).serverUrl,
      'https://x',
    );
    assert.strictEqual(
      normalize({ serverUrl: 'https://x' }).serverUrl,
      'https://x',
    );
  });

  test('customCdn 尾部统一为单个 /，空为未启用', () => {
    assert.strictEqual(
      normalize({ customCdn: 'https://cdn.x/file' }).customCdn,
      'https://cdn.x/file/',
    );
    assert.strictEqual(
      normalize({ customCdn: 'https://cdn.x/file///' }).customCdn,
      'https://cdn.x/file/',
    );
    assert.strictEqual(normalize({ customCdn: '   ' }).customCdn, '');
    assert.strictEqual(normalize({}).customCdn, '');
  });

  test('customCdn 无 scheme 补 https://、host:port 不误判、退化未启用（T8 §2.2）', () => {
    const cdn = (v: string) => normalize({ customCdn: v }).customCdn;
    assert.strictEqual(cdn('cdn.x/img'), 'https://cdn.x/img/');
    assert.strictEqual(cdn('//cdn.x/img'), 'https://cdn.x/img/');
    assert.strictEqual(
      cdn('localhost:8080/img'),
      'https://localhost:8080/img/',
    );
    assert.strictEqual(cdn('http://cdn.x/img/'), 'http://cdn.x/img/'); // 显式 http 保留
    assert.strictEqual(cdn('/'), '');
    assert.strictEqual(cdn('//'), '');
    assert.strictEqual(cdn('://'), '');
    assert.strictEqual(cdn('https://'), '');
  });

  test('remoteWhitelist trim + 小写 + 过滤非法项', () => {
    assert.deepStrictEqual(
      normalize({ remoteWhitelist: [' Img.Shields.IO ', '', 42, 'a.com'] })
        .remoteWhitelist,
      ['img.shields.io', 'a.com'],
    );
  });

  test('非法枚举值回退默认', () => {
    const cfg = normalize({
      authType: 'oops',
      uploadChannel: 'nope',
      uploadNameType: '??',
    });
    assert.strictEqual(cfg.authType, 'authCode');
    assert.strictEqual(cfg.uploadChannel, 'telegram');
    assert.strictEqual(cfg.uploadNameType, 'default');
  });

  test('布尔默认值', () => {
    const cfg = normalize({});
    assert.strictEqual(cfg.serverCompress, true);
    assert.strictEqual(cfg.autoRetry, true);
    assert.strictEqual(cfg.pasteUpload, true);
    assert.strictEqual(cfg.uploadRemoteImages, false);
    assert.strictEqual(
      normalize({ serverCompress: false }).serverCompress,
      false,
    );
  });
});

suite('config 与 package.json 声明一致性', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
  );
  const props = pkg.contributes.configuration.properties;

  test('enum 候选一致', () => {
    assert.deepStrictEqual(props['imgbedUploader.authType'].enum, [
      ...AUTH_TYPES,
    ]);
    assert.deepStrictEqual(props['imgbedUploader.uploadChannel'].enum, [
      ...UPLOAD_CHANNELS,
    ]);
    assert.deepStrictEqual(props['imgbedUploader.uploadNameType'].enum, [
      ...UPLOAD_NAME_TYPES,
    ]);
  });

  test('默认值一致', () => {
    const defaults = normalize({});
    assert.strictEqual(
      props['imgbedUploader.serverUrl'].default,
      defaults.serverUrl,
    );
    assert.strictEqual(
      props['imgbedUploader.authType'].default,
      defaults.authType,
    );
    assert.strictEqual(
      props['imgbedUploader.uploadChannel'].default,
      defaults.uploadChannel,
    );
    assert.strictEqual(
      props['imgbedUploader.channelName'].default,
      defaults.channelName,
    );
    assert.strictEqual(
      props['imgbedUploader.uploadFolder'].default,
      defaults.uploadFolder,
    );
    assert.strictEqual(
      props['imgbedUploader.uploadNameType'].default,
      defaults.uploadNameType,
    );
    assert.strictEqual(props['imgbedUploader.expire'].default, defaults.expire);
    assert.strictEqual(
      props['imgbedUploader.serverCompress'].default,
      defaults.serverCompress,
    );
    assert.strictEqual(
      props['imgbedUploader.autoRetry'].default,
      defaults.autoRetry,
    );
    assert.strictEqual(
      props['imgbedUploader.customCdn'].default,
      defaults.customCdn,
    );
    assert.strictEqual(
      props['imgbedUploader.uploadRemoteImages'].default,
      defaults.uploadRemoteImages,
    );
    assert.deepStrictEqual(
      props['imgbedUploader.remoteWhitelist'].default,
      defaults.remoteWhitelist,
    );
    assert.strictEqual(
      props['imgbedUploader.pasteUpload'].default,
      defaults.pasteUpload,
    );
  });
});
