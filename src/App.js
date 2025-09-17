// App.js — WizMarketing WebView Bridge
// (push + auth: Google live / Kakao native + SafeArea + Channel Share + Image Download→Gallery)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@react-native-firebase/app';
import {
  BackHandler, StyleSheet, Platform, Alert,
  Linking, LogBox, Animated, Easing, StatusBar,
  PermissionsAndroid,
} from 'react-native';
import { WebView } from 'react-native-webview';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import Share from 'react-native-share';

import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';


import { CameraRoll } from '@react-native-camera-roll/camera-roll';

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import SplashScreenRN from './SplashScreenRN';
import ImageResizer from 'react-native-image-resizer';
import { NativeModules } from 'react-native';
const { KakaoLoginModule } = NativeModules;

const APP_VERSION = '1.0.0';
const BOOT_TIMEOUT_MS = 8000;
const MIN_SPLASH_MS = 1200;
const TAG = '[WizApp]';

// ─────────── Google Sign-In 초기화 ───────────
GoogleSignin.configure({
  webClientId: '266866879152-kfquq1i6r89tbqeramjjuaa2csmoegej.apps.googleusercontent.com',
  offlineAccess: true,
});

// ─────────── 공유 유틸/매핑 ───────────
const SOCIAL = Share.Social;
const SOCIAL_MAP = {
  INSTAGRAM: SOCIAL.INSTAGRAM,
  INSTAGRAM_STORIES: SOCIAL.INSTAGRAM_STORIES,
  FACEBOOK: SOCIAL.FACEBOOK,
  TWITTER: SOCIAL.TWITTER,
  SMS: SOCIAL.SMS,
  KAKAO: 'KAKAO',
  NAVER: 'NAVER',
  SYSTEM: 'SYSTEM',
};

function buildFinalText({ caption, hashtags = [], couponEnabled = false, link } = {}) {
  const tags = Array.isArray(hashtags) ? hashtags.join(' ') : (hashtags || '');
  return `${caption || ''}${tags ? `\n\n${tags}` : ''}${couponEnabled ? `\n\n✅ 민생회복소비쿠폰` : ''}${link ? `\n${link}` : ''}`.trim();
}

// RNFS 유틸
function downloadTo(fromUrl, toFile) {
  return RNFS.downloadFile({ fromUrl, toFile }).promise;
}
function guessExt(u = '') {
  u = u.toLowerCase();
  if (u.includes('.png')) return 'png';
  if (u.includes('.webp')) return 'webp';
  if (u.includes('.gif')) return 'gif';
  return 'jpg';
}
function extToMime(e) {
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
}

// ─────────── 이미지 저장: 권한 + 다운로드 + 갤러리 저장 ───────────
async function ensureMediaPermissions() {
  if (Platform.OS !== 'android') return;
  if (Platform.Version >= 33) {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('READ_MEDIA_IMAGES denied');
    }
  } else {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
    );
    if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('WRITE_EXTERNAL_STORAGE denied');
    }
  }
}

async function downloadAndSaveToGallery(url, filename = 'image.jpg') {
  if (!url) throw new Error('no_url');
  await ensureMediaPermissions();

  const ext = (url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const name = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
  const dest = `${RNFS.CachesDirectoryPath}/${Date.now()}_${name}`;

  const { statusCode } = await RNFS.downloadFile({ fromUrl: url, toFile: dest }).promise;
  if (!(statusCode >= 200 && statusCode < 300)) {
    throw new Error(`download failed: ${statusCode}`);
  }
  await CameraRoll.save(dest, { type: 'photo' });
  RNFS.unlink(dest).catch(() => { });
}

// ─────────── 공유 핸들러 (카카오 포함) ───────────
function safeStr(x) {
  if (typeof x === 'string') return x;
  if (x == null) return '';
  try { return String(x); } catch { return ''; }
}
function stripImageUrlsFromText(text) {
  const s = safeStr(text);
  const out = s.replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi, '');
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}


// 보조: 인스타 Stories용 로컬 PNG 보장 (+ cleanup)
async function ensureLocalPng(src) {
  if (!src) throw new Error('no-source');
  if (src.startsWith('file://') || src.startsWith('content://') || src.startsWith('data:')) {
    return { uri: src, cleanup: async () => { } };
  }
  const dlPath = `${RNFS.CachesDirectoryPath}/ig_story_${Date.now()}.png`; // PNG 고정
  const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
  if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`story-download-fail-${r?.statusCode || 'unknown'}`);
  const st = await RNFS.stat(dlPath);
  if (!st.isFile() || Number(st.size) <= 0) throw new Error('story-downloaded-file-empty');
  return {
    uri: `file://${dlPath}`,
    cleanup: async () => { try { await RNFS.unlink(dlPath); } catch (_) { } },
  };
}


// 보조: 인스타 피드/동영상용 로컬 파일 보장 (+ cleanup)
// - preferExt='jpg'일 때는 "진짜" JPEG로 재인코딩해서 반환
async function ensureLocalFile(src, preferExt = 'jpg') {
  if (!src) throw new Error('no-source');

  // 이미 로컬/콘텐츠면 그대로 사용
  if (src.startsWith('file://') || src.startsWith('content://') || src.startsWith('data:')) {
    return { uri: src, cleanup: async () => { } };
  }

  // 1) 일단 원본을 캐시에 다운로드 (확장자는 임시로 붙임)
  const extRaw = (guessExt(src) || preferExt).toLowerCase(); // jpg/webp/...
  const tmpPath = `${RNFS.CachesDirectoryPath}/ig_${Date.now()}.${extRaw}`;
  const r = await RNFS.downloadFile({
    fromUrl: src,
    toFile: tmpPath,
    headers: { Accept: 'image/jpeg,image/*;q=0.8' }, // JPEG 우선 힌트
  }).promise;
  if (!(r && r.statusCode >= 200 && r.statusCode < 300)) {
    throw new Error(`ig-download-fail-${r?.statusCode || 'unknown'}`);
  }
  const st = await RNFS.stat(tmpPath);
  if (!st.isFile() || Number(st.size) <= 0) throw new Error('ig-downloaded-file-empty');

  // 2) preferExt가 'jpg'면 "진짜 JPEG"로 재인코딩 (webp/gif 방지)
  if (preferExt.toLowerCase() === 'jpg' || preferExt.toLowerCase() === 'jpeg') {
    try {
      // 1080px 내로 보정 (너무 크면 실패율↑)
      const resized = await ImageResizer.createResizedImage(
        tmpPath,           // input (file:// 없어도 됨)
        1080,              // maxWidth
        1080,              // maxHeight
        'JPEG',            // format
        90,                // quality
        0,                 // rotation
        undefined,         // outputPath (auto)
        false,             // keepMeta
        { mode: 'contain' } // fit mode
      );
      // cleanup: 원본 삭제
      try { await RNFS.unlink(tmpPath); } catch { }
      const out = resized.path.startsWith('file://') ? resized.path : `file://${resized.path}`;
      return {
        uri: out,
        cleanup: async () => { try { await RNFS.unlink(out.replace('file://', '')); } catch { } },
      };
    } catch (e) {
      // 재인코딩 실패 시 원본으로라도 진행
      const out = tmpPath.startsWith('file://') ? tmpPath : `file://${tmpPath}`;
      return {
        uri: out,
        cleanup: async () => { try { await RNFS.unlink(tmpPath); } catch { } },
      };
    }
  }

  // 3) 동영상/mp4 등은 그대로 반환
  const out = tmpPath.startsWith('file://') ? tmpPath : `file://${tmpPath}`;
  return {
    uri: out,
    cleanup: async () => { try { await RNFS.unlink(tmpPath); } catch { } },
  };
}



async function handleShareToChannel(payload, sendToWeb) {
  const key = (payload?.social || '').toUpperCase();
  const data = payload?.data || {};
  const social = SOCIAL_MAP[key] ?? SOCIAL_MAP.SYSTEM;

  const text = buildFinalText(data);
  let file = data.imageUrl || data.url || data.image;

  try {
    const needClipboard = [Share.Social.INSTAGRAM, Share.Social.INSTAGRAM_STORIES, Share.Social.FACEBOOK].includes(social);
    if (needClipboard && text) {
      Clipboard.setString(text);
      sendToWeb('TOAST', { message: '캡션이 복사되었어요. 업로드 화면에서 붙여넣기 하세요.' });
    }

    const ext = guessExt(file) || 'jpg';
    const mime = extToMime(ext) || 'image/*';

    // Kakao: file:// 로 공유 (기존 유지)
    if (key === 'KAKAO') {
      const src = data.imageUrl || data.url || data.image;
      const cleanText = safeStr(text);
      const pasteText = stripImageUrlsFromText(cleanText);

      const kExt = guessExt(src) || 'jpg';
      const dlPath = `${RNFS.CachesDirectoryPath}/share_${Date.now()}.${kExt}`;
      const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`download ${r?.statusCode || 'fail'}`);
      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('downloaded-file-empty');

      const fileUrl = `file://${dlPath}`;
      const kMime = extToMime(kExt) || 'image/*';

      await Share.open({
        title: '카카오톡으로 공유',
        url: fileUrl,
        type: kMime,
        filename: `share.${kExt}`,
        message: pasteText,
        failOnCancel: false,
      });

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }
    // --- BAND: 카카오와 동일하게 file:// + message ---
    if (key === 'BAND') {
      const src = data.imageUrl || data.url || data.image;
      const cleanText = safeStr(text);
      const body = stripImageUrlsFromText(cleanText);

      const ext = 'jpg';
      const dlPath = `${RNFS.CachesDirectoryPath}/band_${Date.now()}.${ext}`;
      const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`band_download ${r?.statusCode || 'fail'}`);
      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('band_downloaded_empty');

      const fileUrl = `file://${dlPath}`;
      const mime = 'image/jpeg';

      try {
        // (안드) 밴드 설치 확인 → 미설치면 시스템 공유
        if (Platform.OS === 'android') {
          try {
            const { isInstalled } = await Share.isPackageInstalled('com.nhn.android.band');
            if (!isInstalled) throw new Error('band_not_installed');
          } catch {
            await Share.open({ url: fileUrl, type: mime, filename: 'share.jpg', message: body, failOnCancel: false });
            sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
            return;
          }
        }

        await Share.open({
          url: fileUrl,
          type: mime,
          filename: 'share.jpg',
          message: body,
          failOnCancel: false,
        });
      } finally {
        try { await RNFS.unlink(dlPath); } catch { }
      }

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    // --- X(트위터): file:// + message (shareSingle → urls → open 폴백) ---
    if (key === 'X' || social === Share.Social.TWITTER) {
      const src = data.imageUrl || data.url || data.image;
      const cleanText = safeStr(text);
      const body = stripImageUrlsFromText(cleanText); // 이미지 URL 제거(링크 공유 방지)

      const ext = 'jpg';
      const dlPath = `${RNFS.CachesDirectoryPath}/x_${Date.now()}.${ext}`;
      const r = await RNFS.downloadFile({ fromUrl: src, toFile: dlPath }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`x_download ${r?.statusCode || 'fail'}`);
      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('x_downloaded_empty');

      const fileUrl = `file://${dlPath}`;
      const mime = 'image/jpeg';

      try {
        // (안드) 트위터 설치 확인 → 미설치면 시스템 공유
        if (Platform.OS === 'android') {
          try {
            const { isInstalled } = await Share.isPackageInstalled('com.twitter.android');
            if (!isInstalled) throw new Error('x_not_installed');
          } catch {
            await Share.open({ url: fileUrl, type: mime, filename: 'share.jpg', message: body, failOnCancel: false });
            sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
            return;
          }
        }

        // 1차: 트위터 전용 shareSingle
        try {
          await Share.shareSingle({
            social: Share.Social.TWITTER,
            url: fileUrl,
            type: mime,
            filename: 'share.jpg',
            message: body,              // 280자 제한은 트위터가 내부에서 처리(잘림)
            failOnCancel: false,
          });
        } catch {
          // 2차: urls 배열 방식
          try {
            await Share.open({
              urls: [fileUrl],
              type: mime,
              filename: 'share.jpg',
              message: body,
              failOnCancel: false,
            });
          } catch {
            // 3차: 시스템 공유
            await Share.open({
              url: fileUrl,
              type: mime,
              filename: 'share.jpg',
              message: body,
              failOnCancel: false,
            });
          }
        }
      } finally {
        try { await RNFS.unlink(dlPath); } catch { }
      }

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    // --- Instagram Stories: 로컬 PNG + background → sticker 폴백 ---
    if (social === Share.Social.INSTAGRAM_STORIES) {
      // (안드로이드) 인스타 설치 확인
      if (Platform.OS === 'android') {
        try {
          const { isInstalled } = await Share.isPackageInstalled('com.instagram.android');
          if (!isInstalled) {
            sendToWeb('TOAST', { message: '인스타그램이 설치되어 있지 않아요.' });
            const { uri: sysUri, cleanup: sysClean } = await ensureLocalPng(file);
            try {
              await Share.open({ url: sysUri, type: 'image/png', filename: 'share.png', failOnCancel: false });
            } finally { await sysClean(); }
            sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
            return;
          }
        } catch (_) { }
      }

      const { uri: bgUri, cleanup } = await ensureLocalPng(file);
      try {
        // 1차: 배경 이미지 방식
        await Share.shareSingle({
          social: Share.Social.INSTAGRAM_STORIES,
          backgroundImage: bgUri,            // 로컬 PNG
          attributionURL: data.link,         // 선택
          backgroundTopColor: '#000000',     // 선택
          backgroundBottomColor: '#000000',
          type: 'image/png',
          filename: 'share.png',
          failOnCancel: false,
        });
      } catch (e1) {
        try {
          // 2차: 스티커 방식 폴백
          await Share.shareSingle({
            social: Share.Social.INSTAGRAM_STORIES,
            stickerImage: bgUri,              // 스티커로
            attributionURL: data.link,
            backgroundTopColor: '#000000',
            backgroundBottomColor: '#000000',
            type: 'image/png',
            filename: 'share.png',
            failOnCancel: false,
          });
        } catch (e2) {
          // 최종 폴백: 시스템 공유
          await Share.open({ url: bgUri, type: 'image/png', filename: 'share.png', failOnCancel: false });
        }
      } finally {
        await cleanup();
      }

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    // --- Instagram 피드: 로컬 JPG 고정(이미 테스트 완료 흐름) ---
    // --- Instagram 피드: 카카오 방식(file://) 적용 + 간단 폴백 ---
    if (social === Share.Social.INSTAGRAM) {
      const src = data.imageUrl || data.url || data.image;

      // 0) (안드 전용) 인스타 설치 확인
      if (Platform.OS === 'android') {
        try {
          const { isInstalled } = await Share.isPackageInstalled('com.instagram.android');
          if (!isInstalled) {
            sendToWeb('TOAST', { message: '인스타그램이 설치되어 있지 않아요.' });
            // 시스템 공유 폴백
            const dl = `${RNFS.CachesDirectoryPath}/ig_${Date.now()}.jpg`;
            const r0 = await RNFS.downloadFile({ fromUrl: src, toFile: dl, headers: { Accept: 'image/jpeg,image/*;q=0.8' } }).promise;
            if (r0?.statusCode >= 200 && r0?.statusCode < 300) {
              await Share.open({ url: `file://${dl}`, type: 'image/jpeg', filename: 'share.jpg', failOnCancel: false });
            }
            sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
            return;
          }
        } catch { }
      }

      // 1) 파일 다운로드(무조건 JPEG로 저장) + 존재/사이즈 확인
      const dlPath = `${RNFS.CachesDirectoryPath}/ig_${Date.now()}.jpg`;
      const r = await RNFS.downloadFile({
        fromUrl: src,
        toFile: dlPath,
        headers: { Accept: 'image/jpeg,image/*;q=0.8' }, // JPEG 우선 힌트
      }).promise;
      if (!(r && r.statusCode >= 200 && r.statusCode < 300)) throw new Error(`ig-download-fail-${r?.statusCode || 'unknown'}`);

      const st = await RNFS.stat(dlPath);
      if (!st.isFile() || Number(st.size) <= 0) throw new Error('ig-downloaded-file-empty');

      const fileUrl = `file://${dlPath}`;
      const mime = 'image/jpeg';

      try {
        // 2) 1차: shareSingle (인스타 피드 전용)
        await Share.shareSingle({
          social: Share.Social.INSTAGRAM,
          url: fileUrl,                        // ✅ file:// 경로
          type: mime,
          filename: 'share.jpg',
          failOnCancel: false,
        });
      } catch (e1) {
        try {
          // 3) 2차: urls 배열 방식(일부 기기에서 더 잘 먹음)
          await Share.open({
            urls: [fileUrl],
            type: mime,
            filename: 'share.jpg',
            failOnCancel: false,
          });
        } catch (e2) {
          // 4) 최종 폴백: 시스템 공유(사용자가 인스타 선택 가능)
          await Share.open({
            url: fileUrl,
            type: mime,
            filename: 'share.jpg',
            failOnCancel: false,
          });
        }
      }

      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }



    // --- 그 외 채널 ---
    if (typeof social === 'string' && !['SYSTEM', 'KAKAO', 'NAVER'].includes(social)) {
      await Share.shareSingle({
        social,
        url: file,
        message: needClipboard ? undefined : text,
        type: mime,
        filename: `share.${ext}`,
        failOnCancel: false,
      });
      sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });
      return;
    }

    // --- 시스템 공유 ---
    await Share.open({
      url: file,
      message: text,
      title: '공유',
      type: mime,
      filename: `share.${ext}`,
      failOnCancel: false,
    });
    sendToWeb('SHARE_RESULT', { success: true, platform: key, post_id: null });

  } catch (err) {
    sendToWeb('SHARE_RESULT', {
      success: false,
      platform: key,
      error_code: 'share_failed',
      message: String(err?.message || err),
    });
  }
}


async function saveDataUrlToGallery(dataUrl, filename) {
  // dataURL → base64 추출
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('invalid_dataurl');

  const base64 = match[2];
  const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;

  // base64 → 파일
  await RNFS.writeFile(tmpPath, base64, 'base64');
  // 파일 → 갤러리에 저장
  await CameraRoll.save(tmpPath, { type: 'photo' });
}

// ─────────── App 컴포넌트 ───────────
const App = () => {
  const webViewRef = useRef(null);




  const [splashVisible, setSplashVisible] = useState(true);
  const splashStartRef = useRef(0);
  const splashFade = useRef(new Animated.Value(1)).current;

  const bootTORef = useRef(null);
  const [token, setToken] = useState('');
  const lastPushTokenRef = useRef('');
  const lastNavStateRef = useRef({});

  useEffect(() => { LogBox.ignoreAllLogs(true); }, []);

  const sendToWeb = useCallback((type, payload = {}) => {
    try {
      const msg = JSON.stringify({ type, payload });
      webViewRef.current?.postMessage(msg);
    } catch (e) { console.log('❌ postMessage error:', e); }
  }, []);

  // Splash
  const hideSplashRespectingMin = useCallback(() => {
    const elapsed = Date.now() - (splashStartRef.current || Date.now());
    const wait = Math.max(MIN_SPLASH_MS - elapsed, 0);
    setTimeout(() => {
      Animated.timing(splashFade, {
        toValue: 0, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start(() => setSplashVisible(false));
    }, wait);
  }, [splashFade]);

  const showSplashOnce = useCallback(() => {
    if (!splashVisible) {
      setSplashVisible(true);
      splashFade.setValue(1);
      splashStartRef.current = Date.now();
    } else if (!splashStartRef.current) {
      splashStartRef.current = Date.now();
    }
  }, [splashFade, splashVisible]);

  // HW Back
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = lastNavStateRef.current || {};
      const isRoot = nav.isRoot === true;
      const webCanHandle =
        !isRoot || nav.hasBlockingUI === true || nav.needsConfirm === true || nav.canGoBackInWeb === true;

      if (webCanHandle) {
        sendToWeb('BACK_REQUEST', { nav, at: Date.now() });
        return true;
      }

      Alert.alert('앱 종료', '앱을 종료할까요?', [
        { text: '취소', style: 'cancel' },
        { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [sendToWeb]);

  // Web ready/error
  const handleWebReady = useCallback(() => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_READY_ACK', { at: Date.now() });
    hideSplashRespectingMin();
  }, [hideSplashRespectingMin, sendToWeb]);

  const handleWebError = useCallback((payload) => {
    if (bootTORef.current) { clearTimeout(bootTORef.current); bootTORef.current = null; }
    sendToWeb('WEB_ERROR_ACK', { ...(payload || {}), at: Date.now() });
    sendToWeb('OFFLINE_FALLBACK', { reason: payload?.reason || 'js_error', at: Date.now() });
  }, [sendToWeb]);

  // Push permission (notifee)
  const ensureNotificationPermission = useCallback(async () => {
    try {
      const settings = await notifee.requestPermission();
      return !!settings?.authorizationStatus;
    } catch { return false; }
  }, []);

  const replyPermissionStatus = useCallback(({ pushGranted }) => {
    sendToWeb('PERMISSION_STATUS', {
      push: { granted: !!pushGranted, blocked: false },
      token,
    });
  }, [sendToWeb, token]);

  // Push: token + foreground
  useEffect(() => {
    (async () => {
      try {
        const fcmToken = await messaging().getToken();
        setToken(fcmToken);
        lastPushTokenRef.current = fcmToken;

        sendToWeb('PUSH_TOKEN', {
          token: fcmToken, platform: Platform.OS, app_version: APP_VERSION,
          install_id: 'unknown', ts: Date.now(),
        });
      } catch (e) { console.log('❌ FCM token error:', e); }
    })();

    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      sendToWeb('PUSH_EVENT', {
        event: 'received',
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        deeplink: remoteMessage.data?.deeplink,
        messageId: remoteMessage.messageId,
        ts: Date.now(),
      });
    });
    return () => unsubscribe();
  }, [sendToWeb]);

  // Auth: Google/Kakao
  const safeSend = (type, payload) => {
    try { sendToWeb(type, payload); } catch (e) { console.log('[SEND_ERROR]', e); }
  };

  const handleStartSignin = useCallback(async (payload) => {
    const provider = payload?.provider;
    try {
      if (provider === 'google') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        try { await GoogleSignin.signOut(); } catch { }
        try { await GoogleSignin.revokeAccess(); } catch { }
        const res = await GoogleSignin.signIn();
        let idToken = res?.idToken;
        if (!idToken) {
          try { const tokens = await GoogleSignin.getTokens(); idToken = tokens?.idToken || null; } catch { }
        }
        if (!idToken) throw new Error('no_id_token');
        const googleCredential = auth.GoogleAuthProvider.credential(idToken);
        const userCred = await auth().signInWithCredential(googleCredential);
        safeSend('SIGNIN_RESULT', {
          success: true,
          provider: 'google',
          user: {
            uid: userCred.user.uid,
            email: userCred.user.email,
            displayName: userCred.user.displayName,
            photoURL: userCred.user.photoURL,
          },
          expires_at: Date.now() + 6 * 3600 * 1000,
        });
        return;
      }

      if (provider === 'kakao') {
        try {
          const keyHash = await KakaoLoginModule.getKeyHash();
          console.log('[KAKAO] keyHash =', keyHash);

        
          // 3) SSO 로그인 (모듈 구현에 따라 분기)
          let res;
          if (typeof KakaoLoginModule.loginWithKakaoTalk === 'function') {
            res = await KakaoLoginModule.loginWithKakaoTalk();
          } else if (typeof KakaoLoginModule.login === 'function') {
            res = await KakaoLoginModule.login(); // 형이 쓰던 메서드
          } else {
            throw new Error('kakao_module_missing_methods');
          }

          safeSend('SIGNIN_RESULT', {
            success: true,
            provider: 'kakao',
            user: {
              provider_id: String(res.id),
              email: res.email || '',
              displayName: res.nickname || '',
              photoURL: res.photoURL || '',
            },
            tokens: {
              access_token: res.accessToken,
              refresh_token: res.refreshToken || '',
            },
            expires_at: Date.now() + 6 * 3600 * 1000,
          });
          return;
        } catch (err) {
          console.log('[KAKAO LOGIN ERROR]', err);
          safeSend('SIGNIN_RESULT', {
            success: false,
            provider: 'kakao',
            error_code: err?.code || 'kakao_error',
            error_message: err?.message || String(err),
          });
          return;
        }
      }

      throw new Error('unsupported_provider');
    } catch (err) {
      const code =
        (err && typeof err === 'object' && 'code' in err) ? err.code :
          (String(err?.message || '').includes('no_id_token') ? 'no_id_token' : 'unknown_error');
      const msg =
        (err && typeof err === 'object' && 'message' in err && err.message) ||
        (typeof err === 'string' ? err : JSON.stringify(err));
      safeSend('SIGNIN_RESULT', { success: false, provider, error_code: code, error_message: msg });
    }
  }, [sendToWeb]);

  const handleStartSignout = useCallback(async () => {
    try {
      await auth().signOut();
      sendToWeb('SIGNOUT_RESULT', { success: true });
    } catch (err) {
      sendToWeb('SIGNOUT_RESULT', { success: false, error_code: 'signout_error', message: String(err?.message || err) });
    }
  }, [sendToWeb]);

  // Web → App 라우터
  const handleCheckPermission = useCallback(async () => {
    const push = await ensureNotificationPermission();
    replyPermissionStatus({ pushGranted: push });
  }, [ensureNotificationPermission, replyPermissionStatus]);

  const handleRequestPermission = useCallback(async () => {
    const push = await ensureNotificationPermission();
    replyPermissionStatus({ pushGranted: push });
  }, [ensureNotificationPermission, replyPermissionStatus]);

  const onMessageFromWeb = useCallback(async (e) => {
    try {
      const raw = e.nativeEvent.data;
      if (typeof raw === 'string' && raw.startsWith('open::')) {
        const url = raw.replace('open::', '');
        try { await Linking.openURL(url); } catch { }
        return;
      }
      const data = JSON.parse(raw);
      switch (data.type) {
        case 'WEB_READY': await handleWebReady(); break;
        case 'WEB_ERROR': await handleWebError(data.payload); break;

        case 'CHECK_PERMISSION': await handleCheckPermission(); break;
        case 'REQUEST_PERMISSION': await handleRequestPermission(); break;

        case 'START_SUBSCRIPTION': {
          sendToWeb('SUBSCRIPTION_RESULT', {
            success: true,
            product_id: data?.payload?.product_id,
            transaction_id: 'tx_demo_001',
            expires_at: data?.payload?.product_type === 'subscription' ? Date.now() + 30 * 24 * 3600_000 : undefined,
          });
          break;
        }

        case 'START_SHARE': {
          try {
            const { image, caption, platform } = data.payload || {};
            await Share.open({
              title: '공유',
              message: caption ? `${caption}\n` : undefined,
              url: image,
              failOnCancel: false,
            });
            sendToWeb('SHARE_RESULT', { success: true, platform, post_id: null });
          } catch (err) {
            sendToWeb('SHARE_RESULT', { success: false, platform: data?.payload?.platform, error_code: 'share_failed', message: String(err?.message || err) });
          }
          break;
        }

        case 'share.toChannel': {
          await handleShareToChannel(data, sendToWeb);
          break;
        }

        case 'DOWNLOAD_IMAGE': {
          try {
            const { url, dataUrl, filename } = data.payload || {};
            const safeName = filename && filename.includes('.') ? filename : 'image.jpg';

            if (url) {
              // 🌐 URL 다운로드 → 갤러리 저장
              await downloadAndSaveToGallery(url, safeName);
            } else if (dataUrl) {
              // 🖼 dataURL → 파일 디코드 → 갤러리 저장
              await saveDataUrlToGallery(dataUrl, safeName);
            } else {
              throw new Error('no_url_or_dataUrl');
            }

            sendToWeb('DOWNLOAD_RESULT', { success: true, filename: safeName });
            Alert.alert('완료', '이미지가 갤러리에 저장되었습니다.');
          } catch (err) {
            console.log('[DOWNLOAD_IMAGE][error]', err);
            sendToWeb('DOWNLOAD_RESULT', {
              success: false,
              error_code: 'save_failed',
              message: String(err?.message || err),
            });
            Alert.alert('오류', `이미지 저장 실패: ${String(err?.message || err)}`);
          }
          break;
        }


        case 'GET_PUSH_TOKEN': {
          try {
            const t = lastPushTokenRef.current || token || '';
            sendToWeb('PUSH_TOKEN', {
              token: t,
              platform: Platform.OS,
              app_version: APP_VERSION,
              install_id: 'unknown',
              ts: Date.now(),
            });
          } catch (err) {
            sendToWeb('PUSH_TOKEN', {
              token: '',
              platform: Platform.OS,
              app_version: APP_VERSION,
              install_id: 'unknown',
              ts: Date.now(),
              error: String(err?.message || err),
            });
          }
          break;
        }

        case 'START_SIGNIN': await handleStartSignin(data.payload); break;
        case 'START_SIGNOUT': await handleStartSignout(); break;

        case 'EXIT_APP': BackHandler.exitApp(); break;

        case 'NAV_STATE': {
          const nav = data.payload || {};
          lastNavStateRef.current = {
            isRoot: !!nav.isRoot,
            path: nav.path ?? '',
            canGoBackInWeb: nav.canGoBackInWeb === true || nav.canGoBack === true,
            hasBlockingUI: !!nav.hasBlockingUI,
            needsConfirm: !!nav.needsConfirm,
          };
          sendToWeb('NAV_STATE_ACK', { nav: lastNavStateRef.current, at: Date.now() });
          break;
        }

        case 'BACK_PRESSED': {
          const nav = lastNavStateRef.current || {};
          if (nav.isRoot === true) {
            Alert.alert(
              '앱 종료',
              '앱을 종료할까요?',
              [
                { text: '취소', style: 'cancel' },
                { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
              ],
              { cancelable: true }
            );
          } else {
            sendToWeb('BACK_REQUEST', { nav, at: Date.now() });
          }
          break;
        }

        default: console.log('⚠️ unknown msg:', data.type);
      }
    } catch (err) {
      console.error('❌ onMessage error:', err);
    }
  }, [handleCheckPermission, handleRequestPermission, handleStartSignin, handleStartSignout, handleWebError, handleWebReady, sendToWeb, token]);

  // WebView load
  const onWebViewLoadStart = useCallback(() => {
    showSplashOnce();
    if (bootTORef.current) clearTimeout(bootTORef.current);
    bootTORef.current = setTimeout(() => {
      sendToWeb('OFFLINE_FALLBACK', { reason: 'timeout', at: Date.now() });
    }, BOOT_TIMEOUT_MS);
  }, [showSplashOnce, sendToWeb]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <WebView
          ref={webViewRef}
          source={{ uri: 'http://www.wizmarket.ai:53003/ads/login/MA010120220808570604' }}
          onMessage={onMessageFromWeb}
          onLoadStart={onWebViewLoadStart}
          onLoadProgress={({ nativeEvent }) => {
            if (nativeEvent.progress >= 0.9) hideSplashRespectingMin();
          }}
          onLoadEnd={() => { hideSplashRespectingMin(); }}
          javaScriptEnabled
          domStorageEnabled
          focusable
          overScrollMode="never"
          containerStyle={{ backgroundColor: 'transparent', flex: 1 }}
          style={{ backgroundColor: 'transparent', flex: 1 }}
        />
        {splashVisible && (
          <SafeAreaInsetOverlay opacity={splashFade}>
            <SplashScreenRN />
          </SafeAreaInsetOverlay>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

function SafeAreaInsetOverlay({ opacity, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity,
          backgroundColor: 'white',
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});

export default App;
